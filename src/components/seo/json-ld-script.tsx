/**
 * Escapes characters that could let a value inside the JSON-LD payload
 * break out of the surrounding <script> tag (e.g. a Shopify product
 * description or an admin-entered blog title containing "</script>").
 * `<`, `>`, and `&` are all that JSON.stringify's output can contain
 * that HTML would otherwise interpret, so escaping just those three is
 * enough to keep it inert as a script body while still parsing as
 * identical JSON (the target is `application/ld+json`, not HTML).
 */
function escapeForScriptTag(json: string): string {
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: escapeForScriptTag(JSON.stringify(data)) }}
    />
  );
}
