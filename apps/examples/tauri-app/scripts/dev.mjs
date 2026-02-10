import { spawn } from "node:child_process";

const commands = [
  ["pnpm", ["run", "prepare:tauri-assets"]],
  ["pnpm", ["run", "build:node"]],
  ["pnpm", ["run", "prepare:component"]],
];

for (const [cmd, args] of commands) {
  await runOnce(cmd, args);
}

const longRunning = [
  { label: "component", process: createProcess("pnpm", ["run", "prepare:component:watch"]) },
  { label: "helper", process: createProcess("pnpm", ["run", "build:node:watch"]) },
  { label: "convex", process: createProcess("pnpm", ["run", "dev:convex"]) },
  { label: "tauri", process: createProcess("pnpm", ["run", "start"]) },
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const entry of longRunning) {
    if (!entry.process.killed) {
      entry.process.kill("SIGTERM");
    }
  }
  setTimeout(() => {
    process.exit(code);
  }, 200).unref();
}

for (const entry of longRunning) {
  entry.process.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
      shutdown(0);
      return;
    }
    console.error(
      `[dev] process "${entry.label}" exited with code=${code} signal=${signal ?? "-"}`,
    );
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function createProcess(cmd, args) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
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
