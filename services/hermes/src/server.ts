import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { routeHermesTask } from "./router.js";
import { isAuthorized } from "./auth.js";

const port = Number(process.env.HERMES_PORT ?? 8787);
// Loopback by default: this service has no auth boundary of its own
// beyond the bearer key below, and the common way it's run (`npm run
// dev` / `npm start`, per docs/HERMES_LOCAL.md) is directly on a
// developer's machine, not behind a firewall. docker-compose.yml sets
// HERMES_HOST=0.0.0.0 explicitly, since inside a container 127.0.0.1
// isn't reachable through Docker's published-port forwarding.
const host = process.env.HERMES_HOST ?? "127.0.0.1";
// Task payloads are small JSON ({ type, mode, input }), never uploads —
// bound the request body so a caller can't exhaust memory before the
// JSON.parse below even runs.
const MAX_BODY_BYTES = 64 * 1024;

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "daakyka-hermes", fireworks: Boolean(process.env.FIREWORKS_API_KEY) }));
    return;
  }

  if (req.method === "POST" && req.url === "/tasks") {
    if (!isAuthorized(req.headers.authorization, process.env.HERMES_API_KEY)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        total += (chunk as Buffer).length;
        if (total > MAX_BODY_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body too large" }));
          req.destroy();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        type?: string;
        mode?: string;
        input?: Record<string, unknown>;
      };

      if (!body.type) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "type is required" }));
        return;
      }

      const output = await routeHermesTask({
        type: body.type,
        mode: body.mode ?? "SUGGEST_ONLY",
        input: body.input ?? {},
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ taskId: randomUUID(), output: JSON.stringify(output) }));
    } catch (error) {
      // Never forward internal error detail (e.g. Fireworks response
      // bodies, which can include request info) to the caller.
      console.error("Hermes task failed:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Hermes task failed" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, host, () => {
  console.log(`DAAKYKA Hermes agent listening on http://${host}:${port}`);
});
