import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { assertValidClientMessage, parseWireMessage } from "@zakstam/codex-runtime/protocol";
import { classifyMessage, extractStreamId, extractTurnId, type ClassifiedMessage } from "@zakstam/codex-runtime/protocol";
import type { NormalizedEvent, ServerInboundMessage } from "@zakstam/codex-runtime/protocol";
import type { ClientOutboundWireMessage } from "@zakstam/codex-runtime/protocol";

export type BridgeConfig = {
  codexBin?: string;
  cwd?: string;
};

export type BridgeError = {
  line: string;
  error: Error;
};

export type BridgeHandlers = {
  onEvent: (event: NormalizedEvent) => Promise<void> | void;
  onGlobalMessage: (
    message: ServerInboundMessage,
    classification: ClassifiedMessage,
  ) => Promise<void> | void;
  onProtocolError: (error: BridgeError) => Promise<void> | void;
  onProcessExit?: (code: number | null) => void;
};

function shouldLogRawLine(line: string): boolean {
  const mode = process.env.CODEX_BRIDGE_RAW_LOG?.toLowerCase();
  if (!mode || mode === "0" || mode === "false" || mode === "off") {
    return false;
  }
  if (mode === "1" || mode === "true" || mode === "all") {
    return true;
  }
  if (mode === "turns") {
    return (
      line.includes("\"method\":\"turn/") ||
      line.includes("\"turnId\":\"") ||
      line.includes("\"turn\":{\"id\":")
    );
  }
  return false;
}

export class CodexLocalBridge {
  private process: ChildProcessWithoutNullStreams | null = null;
  private cursor = 0;

  constructor(
    private readonly config: BridgeConfig,
    private readonly handlers: BridgeHandlers,
  ) {}

  start(): void {
    if (this.process) {
      throw new Error("Bridge already started");
    }
    const bin = this.config.codexBin ?? process.env.CODEX_BIN ?? "codex";
    const proc = spawn(bin, ["app-server"], {
      cwd: this.config.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = proc;

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      void this.handleLine(line);
    });

    proc.on("exit", (code) => {
      this.process = null;
      this.handlers.onProcessExit?.(code);
    });
  }

  stop(): void {
    this.process?.kill();
    this.process = null;
  }

  send(message: ClientOutboundWireMessage): void {
    if (!this.process) {
      throw new Error("Bridge not started");
    }
    assertValidClientMessage(message);
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async handleLine(line: string): Promise<void> {
    try {
      if (shouldLogRawLine(line)) {
        console.error(`[codex-bridge:raw-in] ${line}`);
      }
      const message = parseWireMessage(line);
      const classification = classifyMessage(message);
      if (classification.scope === "global") {
        await this.handlers.onGlobalMessage(message, classification);
        return;
      }
      const normalized = this.normalize(message, classification.conversationId, classification.kind);
      await this.handlers.onEvent(normalized);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      await this.handlers.onProtocolError({ line, error: normalizedError });
    }
  }

  private normalize(message: ServerInboundMessage, conversationId: string, kind: string): NormalizedEvent {
    const start = this.cursor;
    this.cursor += 1;

    const turnId = extractTurnId(message);
    const streamId = extractStreamId(message);
    const resolvedStreamId = streamId ?? (turnId ? `${conversationId}:${turnId}:0` : undefined);

    return {
      eventId: randomUUID(),
      threadId: conversationId,
      ...(turnId ? { turnId } : {}),
      ...(resolvedStreamId ? { streamId: resolvedStreamId } : {}),
      cursorStart: start,
      cursorEnd: this.cursor,
      kind,
      payloadJson: JSON.stringify(message),
      createdAt: Date.now(),
    };
  }
}
