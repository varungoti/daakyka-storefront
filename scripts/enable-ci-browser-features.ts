/** Turn on optional public pages only in the disposable Docker CI database. */
import { db } from "../src/lib/db";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "postgres" || url.pathname !== "/daakyka_ci" || process.env.CI !== "1") {
  throw new Error("Optional CI feature setup refused outside the disposable Docker database");
}

async function main() {
  try {
    for (const key of ["pages.fabricTech.enabled", "pages.mixMatch.enabled"]) {
      await db.siteSetting.upsert({
        where: { key },
        create: { key, value: true },
        update: { value: true },
      });
    }
    console.log("Enabled Fabric Technology and Mix & Match only in CI.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
