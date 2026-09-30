# Local Docker CI/CD

GitHub Actions are disabled for this repository. Run release verification from a clean checkout with Docker Desktop running:

```powershell
node scripts/local-release.mjs
```

This builds `Dockerfile.ci` and starts the isolated services in `compose.local-ci.yml`. The image uses Node 22 and its matching Playwright Chromium browser; PostgreSQL 16 runs on a temporary in-memory filesystem with no host port. The checkout's `.env`, credentials, build output, and Git metadata are excluded from the Docker build context. The container receives only disposable test credentials.

The gate runs the production dependency audit, migrations and seed, publishes the catalog only in its disposable CI database, then runs lint, typecheck, unit and integration tests. It enables the optional Mix & Match and Fabric Technology pages only in that database before the production build so the browser gate exercises them. It then runs server health, smoke, core browser, dogfood, accessibility, Lighthouse mobile, and a local sitemap/link/image crawl. The report is saved at `dogfood-output/local-ci/report.json`. A failed stage stops the release.

For a faster browser-only diagnostic run while fixing page tests, use `node scripts/local-ci.mjs --browser-only`. This mode still uses a new database and build, but it omits the audit, lint, typecheck and backend test stages. It is not accepted by `local-release.mjs` as a full release gate.

To run the same gate and publish its exact clean Git revision to Vercel Production:

```powershell
node scripts/local-release.mjs --deploy
```

After Vercel reports success, the script checks the public alias's health and product API twice, all visible category destinations, and every sitemap link and rendered image target. It saves `dogfood-output/local-ci/deployment-report.json`. The local Vercel CLI must already be authenticated and the project linked. This command does not push `.env` values or change production environment variables. Use the production runbook for deliberate credential changes.

The release command also builds the production AR try-on image, runs its tests in a derived Docker image, and smokes the production image's health endpoint. Run that gate alone with `node scripts/local-ar-ci.mjs`. Railway publication requires a Railway token and configured service; storefront release verification does not silently substitute a local container for that external deployment.

Product imagery, real payment and email credentials, admin password rotation, owner purchase verification, and search indexing remain independent launch gates in the master roadmap.
