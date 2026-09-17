import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { MAX_LONG_EDGE, processImage } from "@/lib/media/process-image";

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
});
