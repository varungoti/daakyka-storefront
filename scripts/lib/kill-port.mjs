/**
 * Port cleanup for the local verify scripts (scripts/predeploy-verify.mjs,
 * scripts/verify-101.mjs).
 *
 * F-309: these scripts used to run `netstat -ano | findstr :3000` and
 * `taskkill /PID <pid> /F` every PID on every matching line. That substring
 * also matches local ports 30000-30009, any connection whose REMOTE port is
 * 3000 (a browser tab open on localhost:3000, the script's own keep-alive
 * client sockets), and force-killed all of them without asking. The helpers
 * here only ever consider sockets that are LISTENING on exactly the requested
 * port, never the current process, and the pre-run cleanup needs an explicit
 * opt-in (`--kill-port` / `KILL_PORT=1`) instead of happening silently.
 */
import { spawnSync } from "node:child_process";

/**
 * Pure: PIDs that are listening on exactly `port` in Windows
 * `netstat -ano -p tcp` output.
 *
 * Columns: Proto, Local Address, Foreign Address, State, PID. A listening
 * socket is recognised by its foreign address ending in `:0` rather than by
 * the State text, because the State column is translated on non-English
 * Windows.
 */
export function parseNetstatListeners(output, port) {
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0].toUpperCase() !== "TCP") continue;
    const local = columns[1];
    const foreign = columns[2];
    const pid = columns[columns.length - 1];
    if (!foreign.endsWith(":0")) continue;
    if (!local.endsWith(`:${port}`)) continue;
    if (!/^\d+$/.test(pid) || pid === "0") continue;
    pids.add(Number(pid));
  }
  return [...pids];
}

/** PIDs of processes listening on `port`, excluding this process. */
export function listeningPids(port) {
  if (process.platform === "win32") {
    const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) return [];
    return parseNetstatListeners(result.stdout, port).filter((pid) => pid !== process.pid);
  }
  // lsof exits 1 when nothing matches; a missing lsof just yields "unknown".
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (!result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number)
    .filter((pid) => pid !== process.pid);
}

function killPids(pids) {
  for (const pid of pids) {
    if (process.platform === "win32") {
      // /T takes the listener's own children with it (npm start -> next).
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

/** Kills whatever is LISTENING on `port` (never this process). Returns the PIDs. */
export function killPort(port) {
  const pids = listeningPids(port);
  killPids(pids);
  return pids;
}

/**
 * True when the operator explicitly allowed terminating a process on the port.
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 */
export function wantsKillPort(argv = process.argv, env = process.env) {
  return argv.includes("--kill-port") || env.KILL_PORT === "1";
}

/**
 * Makes sure nothing is listening on `port` before a script starts its own
 * server there. Throws (and kills nothing) unless `allowKill` is set.
 * `find` and `kill` are injectable for tests.
 * @param {number | string} port
 * @param {{ allowKill?: boolean, find?: (port: number | string) => number[], kill?: (pids: number[]) => void }} [options]
 */
export function ensurePortFree(port, { allowKill = false, find = listeningPids, kill = killPids } = {}) {
  const pids = find(port);
  if (pids.length === 0) return;
  if (!allowKill) {
    throw new Error(
      `Port ${port} is already in use by process ${pids.join(", ")}. Stop it, choose another PORT, ` +
        "or re-run with --kill-port (or KILL_PORT=1) to let this script terminate it.",
    );
  }
  console.log(`Stopping process ${pids.join(", ")} listening on :${port} (--kill-port).`);
  kill(pids);
}
