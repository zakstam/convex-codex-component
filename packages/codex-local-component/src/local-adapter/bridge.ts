import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { assertValidClientMessage, parseWireMessage } from "../protocol/parser.js";
import {
  classifyMessage,
  extractStreamId,
  extractTurnId,
  type ClassifiedMessage,
} from "../protocol/classifier.js";
import type { ClientOutboundMessage, NormalizedEvent, ServerInboundMessage } from "../protocol/generated.js";

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

  send(message: ClientOutboundMessage): void {
    if (!this.process) {
      throw new Error("Bridge not started");
    }
    assertValidClientMessage(message);
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async handleLine(line: string): Promise<void> {
    try {
      const message = parseWireMessage(line);
      const classification = classifyMessage(message);
      if (classification.scope === "global") {
        await this.handlers.onGlobalMessage(message, classification);
        return;
      }
      const normalized = this.normalize(message, classification.threadId, classification.kind);
      await this.handlers.onEvent(normalized);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      await this.handlers.onProtocolError({ line, error: normalizedError });
    }
  }

  private normalize(message: ServerInboundMessage, threadId: string, kind: string): NormalizedEvent {
    const start = this.cursor;
    this.cursor += 1;

    const turnId = extractTurnId(message);
    const streamId = extractStreamId(message);
    const resolvedStreamId = streamId ?? (turnId ? `${threadId}:${turnId}:0` : undefined);

    return {
      eventId: randomUUID(),
      threadId,
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
