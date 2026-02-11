import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";
const SHUTDOWN_GRACE_MS = 1200;

const commands = [
  ["pnpm", ["run", "prepare:tauri-assets"]],
  ["pnpm", ["run", "build:node"]],
  ["pnpm", ["run", "prepare:component"]],
];

for (const [cmd, args] of commands) {
  await runOnce(cmd, args);
}

const longRunning = [
  { label: "component", process: createLongRunningProcess("pnpm", ["run", "prepare:component:watch"]) },
  { label: "helper", process: createLongRunningProcess("pnpm", ["run", "build:node:watch"]) },
  { label: "convex", process: createLongRunningProcess("pnpm", ["run", "dev:convex"]) },
  { label: "tauri", process: createLongRunningProcess("pnpm", ["run", "start"]) },
];

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await Promise.all(longRunning.map((entry) => terminateProcessTree(entry.process, "SIGTERM")));
  await delay(SHUTDOWN_GRACE_MS);
  await Promise.all(
    longRunning
      .filter((entry) => isAlive(entry.process))
      .map((entry) => terminateProcessTree(entry.process, "SIGKILL")),
  );
  process.exit(code);
}

for (const entry of longRunning) {
  entry.process.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
      void shutdown(0);
      return;
    }
    console.error(
      `[dev] process "${entry.label}" exited with code=${code} signal=${signal ?? "-"}`,
    );
    void shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});

function createLongRunningProcess(cmd, args) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
    detached: !isWindows,
  });
  return child;
}

function runOnce(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`[dev] failed: ${cmd} ${args.join(" ")} (code=${code}, signal=${signal ?? "-"})`));
    });
    child.on("error", reject);
  });
}

function isAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function terminateProcessTree(child, signal) {
  if (!child.pid || !isAlive(child)) {
    return;
  }

  if (isWindows) {
    const args = ["/pid", String(child.pid), "/t", "/f"];
    try {
      await execFileAsync("taskkill", args);
    } catch (error) {
      if (isAlive(child)) {
        throw error;
      }
    }
    return;
  }

  const targetPid = child.pid;
  try {
    process.kill(-targetPid, signal);
    return;
  } catch {
    // Fall through to direct child signaling when process-group signaling is unavailable.
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore failures during shutdown races.
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
