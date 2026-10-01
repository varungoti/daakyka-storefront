import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { InvalidImageError, MAX_INPUT_PIXELS, MAX_LONG_EDGE, processImage } from "@/lib/media/process-image";

async function makePng(width: number, height: number, withExifOrientation = false): Promise<Buffer> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 120 },
    },
  }).png();

  if (withExifOrientation) {
    // Orientation 6 = rotate 90deg CW on display; sharp's rotate() should
    // apply this and then strip the tag from the output.
    return image.withExif({ IFD0: { Orientation: "6" } }).toBuffer();
  }
  return image.toBuffer();
}

// F-359: builds a PNG whose IHDR chunk *declares* a huge width/height
// without ever encoding that many real pixels — the IDAT is a tiny deflate
// of a few zero bytes, so this fixture is a few dozen bytes on the wire but
// still exercises sharp's pixel-limit check, which reads the declared
// dimensions from the header before decoding any pixel data. Building a
// *real* 256-megapixel image (even a single-colour one) would mean
// allocating the same hundreds of megabytes of pixel buffer this test
// exists to prove processImage now refuses to allocate.
function crc32(buf: Buffer): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let cachedCrcTable: number[] | undefined;
function crc32Table(): number[] {
  if (cachedCrcTable) return cachedCrcTable;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  cachedCrcTable = table;
  return table;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function makeDeclaredSizePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  // ihdr[10..12] (compression/filter/interlace) already zeroed by Buffer.alloc.
  const idat = deflateSync(Buffer.alloc(10));
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("processImage", () => {
  it("converts the input to WebP", async () => {
    const input = await makePng(800, 600);
    const result = await processImage(input);
    assert.equal(result.contentType, "image/webp");

    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.format, "webp");
  });

  it("caps the long edge at MAX_LONG_EDGE without enlarging small images", async () => {
    const wide = await makePng(5000, 2000);
    const result = await processImage(wide);
    assert.ok(result.width <= MAX_LONG_EDGE, `width ${result.width} should be <= ${MAX_LONG_EDGE}`);
    assert.ok(result.height <= MAX_LONG_EDGE);
    // Aspect ratio roughly preserved (5000x2000 -> 2.5:1)
    assert.ok(Math.abs(result.width / result.height - 2.5) < 0.05);

    const small = await makePng(400, 300);
    const smallResult = await processImage(small);
    assert.equal(smallResult.width, 400, "should not upscale a small image");
    assert.equal(smallResult.height, 300);
  });

  it("strips EXIF metadata from the output", async () => {
    const input = await makePng(800, 600, true);
    const result = await processImage(input);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(meta.orientation, undefined);
  });

  it("reports width/height matching the actual output image", async () => {
    const input = await makePng(1200, 900);
    const result = await processImage(input);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(result.width, meta.width);
    assert.equal(result.height, meta.height);
  });

  // F-064: a route's catch-all used to let sharp's raw decode error
  // through as an opaque 500 — processImage now wraps it as a typed error
  // every upload route can map to a clear 400 instead.
  it("throws InvalidImageError — not sharp's raw error — for bytes that aren't a readable image", async () => {
    await assert.rejects(() => processImage(Buffer.from("this is not an image")), InvalidImageError);
  });

  // F-187: a text file renamed to a.jpg (declared image/jpeg) and a truncated
  // download are the two ways a "valid-looking" upload used to 500.
  it("throws InvalidImageError for a renamed text file and for a truncated JPEG", async () => {
    await assert.rejects(() => processImage(Buffer.from("just some notes, not a jpeg\n".repeat(50))), InvalidImageError);

    const jpeg = await sharp(randomBytes(600 * 400 * 3), { raw: { width: 600, height: 400, channels: 3 } })
      .jpeg()
      .toBuffer();
    await assert.rejects(() => processImage(jpeg.subarray(0, Math.floor(jpeg.length * 0.6))), InvalidImageError);
  });

  // F-187: the route only sees the *declared* MIME type, so an SVG sent as
  // image/jpeg used to be accepted and rasterised by librsvg.
  it("rejects formats that aren't JPEG/PNG/WebP/AVIF even though sharp can decode them (SVG, GIF)", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>');
    // Sanity check that sharp itself would have decoded it, so this test
    // proves the sniff — not a decode failure — is what rejects it.
    assert.equal((await sharp(svg).metadata()).format, "svg");
    await assert.rejects(() => processImage(svg), InvalidImageError);

    const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .gif()
      .toBuffer();
    await assert.rejects(() => processImage(gif), InvalidImageError);
  });

  it("accepts real JPEG, WebP and AVIF input (AVIF reports itself as heif/av1 to sharp)", async () => {
    const base = { create: { width: 64, height: 48, channels: 3 as const, background: { r: 9, g: 99, b: 199 } } };
    for (const [name, input] of [
      ["jpeg", await sharp(base).jpeg().toBuffer()],
      ["webp", await sharp(base).webp().toBuffer()],
      ["avif", await sharp(base).avif().toBuffer()],
    ] as const) {
      const result = await processImage(input);
      assert.equal(result.width, 64, `${name} width`);
      assert.equal(result.height, 48, `${name} height`);
    }
  });

  // F-359: a 16000x16000 declared PNG is 256 megapixels — comfortably under
  // sharp's own default 268 MP safety limit (so it would decode, and
  // allocate ~190 MB, without our own tighter cap) but well over
  // MAX_INPUT_PIXELS. Asserts both that it's rejected and that it's
  // rejected *for exceeding the pixel limit* specifically (not some other
  // decode failure), so this test would fail if a future change silently
  // dropped the `limitInputPixels` option.
  it("rejects a small file that declares dimensions over MAX_INPUT_PIXELS, before decoding it", async () => {
    const width = 16000;
    const height = 16000;
    assert.ok(width * height > MAX_INPUT_PIXELS, "fixture must exceed MAX_INPUT_PIXELS");
    const bomb = makeDeclaredSizePng(width, height);
    assert.ok(bomb.length < 1024, "fixture should be tiny on the wire, not a real 256MP image");

    await assert.rejects(() => processImage(bomb), (error: unknown) => {
      assert.ok(error instanceof InvalidImageError);
      assert.ok(
        error.cause instanceof Error && /pixel limit/i.test(error.cause.message),
        `expected a pixel-limit error, got: ${error.cause instanceof Error ? error.cause.message : error.cause}`,
      );
      return true;
    });
  });
});
