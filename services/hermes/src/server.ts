import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { routeHermesTask } from "./router.js";

const port = Number(process.env.HERMES_PORT ?? 8787);

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "daakyka-hermes", fireworks: Boolean(process.env.FIREWORKS_API_KEY) }));
    return;
  }

  if (req.method === "POST" && req.url === "/tasks") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
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
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Hermes task failed",
        }),
      );
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, () => {
  console.log(`DAAKYKA Hermes agent listening on http://localhost:${port}`);
});
