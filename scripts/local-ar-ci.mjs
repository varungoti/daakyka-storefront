/** Build and verify the AR service image without relying on GitHub Actions. */
import { spawnSync } from "node:child_process";

function run(name, args) {
  console.log(`\n==> ${name}`);
  const result = spawnSync("docker", args, {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed (${result.status})`);
}

run("Build production AR image", ["build", "-t", "daakyka-ar-tryon:local", "services/ar-tryon"]);
run("Build AR test image", [
  "build", "-f", "services/ar-tryon/Dockerfile.ci",
  "-t", "daakyka-ar-tryon-ci:local", "services/ar-tryon",
]);
run("AR unit and API tests", ["run", "--rm", "daakyka-ar-tryon-ci:local"]);
run("Production image health smoke", [
  "run", "--rm", "--entrypoint", "python", "daakyka-ar-tryon:local",
  "-c", "from fastapi.testclient import TestClient; from app.main import app; r = TestClient(app).get('/health'); assert r.status_code == 200 and r.json()['ok'] is True",
]);
console.log("AR production image and tests passed locally.");
