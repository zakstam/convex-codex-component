import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, printHelp } from "./repl.js";
import { parseCommand } from "./commandMap.js";
import {
  EMPTY_SNAPSHOT,
  isHelperEvent,
  type BridgeSnapshot,
  type HarnessEvent,
  type HelperEvent,
} from "./eventModel.js";
import { Timeline } from "./timeline.js";
import { StallDetector } from "./stallDetector.js";
import { writeTrace } from "./traceWriter.js";
import { HELPER_ACK_BY_TYPE, type HelperCommand } from "@zakstam/codex-local-component/host/tauri";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

type CommandRecord = {
  id: string;
  command: HelperCommand;
};

function now(): number {
  return Date.now();
}

function commandId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

class DebugHarness {
  private readonly timeline = new Timeline();
  private readonly stalls = new StallDetector();
  private process: ChildProcessWithoutNullStreams | null = null;
  private snapshot: BridgeSnapshot = { ...EMPTY_SNAPSHOT };
  private readonly sent: CommandRecord[] = [];
  private rawEnabled = false;
  private pollTimer: NodeJS.Timeout | null = null;

  startProcess(): void {
    if (this.process) {
      return;
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const helperPath = resolve(here, "../../tauri-app/dist-node/bridge-helper.js");
    this.process = spawn(process.execPath, [helperPath], {
      stdio: "pipe",
      env: process.env,
    });

    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");

    let outBuf = "";
    this.process.stdout.on("data", (chunk: string) => {
      outBuf += chunk;
      while (true) {
        const idx = outBuf.indexOf("\n");
        if (idx < 0) break;
        const line = outBuf.slice(0, idx).trim();
        outBuf = outBuf.slice(idx + 1);
        if (line) this.handleStdout(line);
      }
    });

    this.process.stderr.on("data", (chunk: string) => {
      const line = String(chunk).trim();
      if (!line) return;
      if (this.rawEnabled) {
        console.log(`[stderr] ${line}`);
      }
      this.timeline.add({ ts: now(), source: "stderr", label: "stderr", payload: line });
    });

    this.process.on("exit", (code) => {
      this.timeline.add({
        ts: now(),
        source: "system",
        label: "helper_exit",
        payload: { code },
      });
      this.process = null;
      this.snapshot = { ...EMPTY_SNAPSHOT };
      console.log(`Helper exited (${code ?? "null"}).`);
    });

    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        for (const signal of this.stalls.poll(now(), this.snapshot)) {
          this.timeline.add({
            ts: now(),
            source: "system",
            label: "stall",
            payload: signal,
            correlatedCommandId: signal.commandId,
          });
          console.error(`[stall:${signal.code}] ${signal.message}`);
        }
      }, 500);
    }
  }

  async stopProcess(): Promise<void> {
    const proc = this.process;
    if (!proc) return;
    await this.send({ type: "stop" });
    await new Promise((resolveStop) => setTimeout(resolveStop, 150));
    if (proc.exitCode === null && !proc.killed) {
      proc.kill();
    }
    this.process = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(command: HelperCommand): Promise<void> {
    this.startProcess();
    if (!this.process) {
      throw new Error("helper process unavailable");
    }
    const id = commandId();
    const line = JSON.stringify(command);
    this.sent.push({ id, command });
    this.timeline.add({
      ts: now(),
      source: "stdin",
      label: "command",
      payload: command,
      correlatedCommandId: id,
    });
    this.process.stdin.write(`${line}\n`);
    this.stalls.create(id, command.type, now());
  }

  isReady(): boolean {
    return this.snapshot.running && typeof this.snapshot.localThreadId === "string" && this.snapshot.localThreadId.length > 0;
  }

  async waitForReady(timeoutMs = 15_000): Promise<void> {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (this.isReady()) {
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    throw new Error("Timed out waiting for running bridge with localThreadId.");
  }

  async waitForTurnSignal(timeoutMs = 30_000): Promise<void> {
    const start = now();
    const deadline = start + timeoutMs;
    while (now() < deadline) {
      const events = this.timeline.all();
      const sawTurnProgress = events.some((event) => {
        if (event.label !== "event" || typeof event.payload !== "object" || event.payload === null) {
          return false;
        }
        const kind = Reflect.get(event.payload, "kind");
        return kind === "turn/started"
          || kind === "turn/completed"
          || kind === "item/agentMessage/delta";
      });
      if (sawTurnProgress) {
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    throw new Error("Timed out waiting for turn response events after send_turn.");
  }

  setRaw(enabled: boolean): void {
    this.rawEnabled = enabled;
    console.log(`raw mode: ${enabled ? "on" : "off"}`);
  }

  printTimeline(limit = 100): void {
    this.timeline.print(limit);
  }

  async saveTrace(pathname?: string): Promise<void> {
    const out = pathname ?? `./traces/${new Date().toISOString().replaceAll(":", "-")}.jsonl`;
    const path = await writeTrace(out, this.timeline.all());
    console.log(`Trace written: ${path}`);
  }

  private handleStdout(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.timeline.add({ ts: now(), source: "stdout", label: "text", payload: line });
      if (this.rawEnabled) console.log(`[stdout] ${line}`);
      return;
    }
    if (!isHelperEvent(parsed)) {
      this.timeline.add({ ts: now(), source: "stdout", label: "unknown", payload: parsed });
      if (this.rawEnabled) console.log(`[stdout] ${JSON.stringify(parsed)}`);
      return;
    }
    const event = parsed as HelperEvent;
    const corr = this.correlate(event);
    this.timeline.add({
      ts: now(),
      source: "stdout",
      label: event.type,
      payload: event.payload,
      ...(corr ? { correlatedCommandId: corr } : {}),
    });
    if (event.type === "state") {
      this.snapshot = event.payload;
    }
    if (this.rawEnabled || event.type === "protocol_error" || event.type === "error") {
      console.log(`[${event.type}] ${JSON.stringify(event.payload)}`);
    }
  }

  private correlate(event: HelperEvent): string | undefined {
    if (this.sent.length === 0) return undefined;
    const latest = this.sent[this.sent.length - 1];
    for (const record of this.sent) {
      this.stalls.observe(record.id, event);
    }
    if (event.type === "ack") {
      const match = [...this.sent].reverse().find((entry) => {
        const needAck = HELPER_ACK_BY_TYPE[entry.command.type];
        return needAck && event.payload.command === entry.command.type;
      });
      return match?.id;
    }
    return latest?.id;
  }
}

async function runScenario(harness: DebugHarness, file: string, defaults: {
  convexUrl: string;
  userId: string;
  sessionId: string;
  cwd?: string;
  model?: string;
}): Promise<void> {
  const contents = await readFile(resolve(file), "utf8");
  const lines = JSON.parse(contents) as string[];
  for (const line of lines) {
    const parsed = parseCommand(line, defaults);
    if (parsed.kind === "helper") {
      await harness.send(parsed.helper);
      if (parsed.helper.type === "start") {
        await harness.waitForReady();
      } else if (parsed.helper.type === "send_turn") {
        await harness.waitForTurnSignal();
      } else {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
}

async function main(): Promise<void> {
  const defaults: {
    convexUrl: string;
    userId: string;
    sessionId: string;
    cwd?: string;
    model?: string;
  } = {
    convexUrl: process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL ?? "http://127.0.0.1:3210",
    userId: process.env.CODEX_DEBUG_USER_ID ?? "debug-user",
    sessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  if (process.env.VITE_CODEX_CWD) {
    defaults.cwd = process.env.VITE_CODEX_CWD;
  }
  if (process.env.VITE_CODEX_MODEL) {
    defaults.model = process.env.VITE_CODEX_MODEL;
  }
  const harness = new DebugHarness();

  const args = process.argv.slice(2);
  const scenarioIndex = args.indexOf("--scenario");
  const scenarioPath = scenarioIndex >= 0 ? args[scenarioIndex + 1] : undefined;
  if (scenarioPath) {
    await runScenario(harness, scenarioPath, defaults);
    await harness.saveTrace();
    await harness.stopProcess();
    return;
  }

  console.log("Codex debug harness started.");
  console.log(`Default convex URL: ${defaults.convexUrl}`);
  printHelp();

  const rl = createInterface();
  rl.prompt();
  rl.on("line", async (line) => {
    try {
      const parsed = parseCommand(line, defaults);
      if (parsed.kind === "local") {
        if (parsed.action === "help") printHelp();
        if (parsed.action === "timeline") harness.printTimeline();
        if (parsed.action === "raw") harness.setRaw(true);
        if (parsed.action === "save-trace") await harness.saveTrace();
        if (parsed.action === "exit") {
          await harness.stopProcess();
          rl.close();
          process.exit(0);
        }
      } else {
        await harness.send(parsed.helper);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
    } finally {
      rl.prompt();
    }
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
