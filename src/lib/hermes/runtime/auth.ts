export function authorizeHermesRuntime(request: Request): boolean {
  const expected = process.env.HERMES_API_KEY ?? process.env.CRON_SECRET;
  if (!expected) return true;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  return header.slice("Bearer ".length) === expected;
}
