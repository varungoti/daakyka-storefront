import type { CredentialProvider, IntegrationProvider } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Lets a test that needs "nothing configured" for an integration provider
 * borrow the real tables without destroying what an owner configured there.
 *
 * The credential and integration-enabled suites used to end with an
 * unconditional `deleteMany` on the Razorpay/Brevo rows, so a run against a
 * database where someone had saved real keys (the shared dev DB, or by
 * accident any other) wiped them — and the "never set" assertions failed
 * for the same reason (F-080). This saves the in-scope rows, empties them
 * so the test starts from a known state, and returns a function that puts
 * the original rows back exactly (ids and timestamps included).
 *
 * Call the returned function from `after()`. It also removes whatever the
 * test left behind in scope, so tests no longer need their own cleanup.
 */
export async function stashIntegrationState(scope: {
  credentialProviders?: CredentialProvider[];
  settingProviders?: IntegrationProvider[];
}): Promise<() => Promise<void>> {
  const credentialWhere = { provider: { in: scope.credentialProviders ?? [] } };
  const settingWhere = { provider: { in: scope.settingProviders ?? [] } };

  const credentials = await db.integrationCredential.findMany({ where: credentialWhere });
  const settings = await db.integrationSetting.findMany({ where: settingWhere });
  await db.integrationCredential.deleteMany({ where: credentialWhere });
  await db.integrationSetting.deleteMany({ where: settingWhere });

  return async () => {
    await db.integrationCredential.deleteMany({ where: credentialWhere });
    await db.integrationSetting.deleteMany({ where: settingWhere });

    if (credentials.length > 0) {
      // updatedById is a foreign key; a user removed since the snapshot
      // must not make the whole restore fail.
      const authorIds = [...new Set(credentials.flatMap((row) => (row.updatedById ? [row.updatedById] : [])))];
      const existing = new Set(
        (await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true } })).map((user) => user.id),
      );
      await db.integrationCredential.createMany({
        data: credentials.map((row) => ({
          ...row,
          updatedById: row.updatedById && existing.has(row.updatedById) ? row.updatedById : null,
        })),
      });
    }
    if (settings.length > 0) {
      await db.integrationSetting.createMany({ data: settings });
    }
  };
}
