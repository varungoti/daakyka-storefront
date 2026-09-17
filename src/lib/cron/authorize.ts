import { safeEquals } from "@/lib/security/timing-safe-equal";

export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return safeEquals(header.slice("Bearer ".length), secret);
}
