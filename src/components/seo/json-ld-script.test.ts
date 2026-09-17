import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JsonLdScript } from "@/components/seo/json-ld-script";

// JsonLdScript is a plain function returning a React element description;
// calling it directly (without a renderer) is enough to inspect the
// dangerouslySetInnerHTML string it produces.
function renderedHtml(data: Record<string, unknown>): string {
  const element = JsonLdScript({ data }) as unknown as {
    props: { dangerouslySetInnerHTML: { __html: string } };
  };
  return element.props.dangerouslySetInnerHTML.__html;
}

describe("JsonLdScript", () => {
  it("escapes </script> so it can't break out of the surrounding tag", () => {
    const html = renderedHtml({ name: '</script><script>alert(1)</script>' });
    assert.ok(!html.includes("</script>"));
    assert.ok(!html.includes("<script>"));
    // Still valid JSON once the </> escapes are reversed by a parser.
    assert.equal(JSON.parse(html).name, '</script><script>alert(1)</script>');
  });

  it("escapes a bare ampersand", () => {
    const html = renderedHtml({ name: "Fit & Flow" });
    assert.ok(!html.includes(" & "));
    assert.equal(JSON.parse(html).name, "Fit & Flow");
  });

  it("produces plain JSON for ordinary data", () => {
    const html = renderedHtml({ a: 1, b: "two" });
    assert.deepEqual(JSON.parse(html), { a: 1, b: "two" });
  });
});
