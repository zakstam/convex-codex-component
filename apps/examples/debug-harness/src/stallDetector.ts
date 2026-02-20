import type { BridgeSnapshot, HelperEvent } from "./eventModel.js";

export type StallCode =
  | "E_STALL_NO_ACK"
  | "E_STALL_NO_TURN_EVENTS"
  | "E_STALL_THREAD_BINDING";

type Expectation = {
  id: string;
  commandType: string;
  createdAt: number;
  ackBy?: number;
  firstTurnEventBy?: number;
  runningBy?: number;
  seenAck: boolean;
  seenTurnEvent: boolean;
  seenRunning: boolean;
};

export type StallSignal = {
  code: StallCode;
  commandId: string;
  commandType: string;
  message: string;
  snapshot: BridgeSnapshot;
};

export class StallDetector {
  private readonly pending = new Map<string, Expectation>();

  create(commandId: string, commandType: string, now: number): void {
    const base: Expectation = {
      id: commandId,
      commandType,
      createdAt: now,
      seenAck: false,
      seenTurnEvent: false,
      seenRunning: false,
    };
    if (commandType === "start") {
      base.ackBy = now + 5_000;
      base.runningBy = now + 15_000;
    } else if (commandType === "send_turn") {
      base.ackBy = now + 5_000;
      base.firstTurnEventBy = now + 20_000;
    } else if (commandType === "interrupt") {
      base.ackBy = now + 5_000;
    }
    this.pending.set(commandId, base);
  }

  observe(commandId: string, event: HelperEvent): void {
    const exp = this.pending.get(commandId);
    if (!exp) {
      return;
    }
    if (event.type === "ack" && event.payload.command === exp.commandType) {
      exp.seenAck = true;
    }
    if (event.type === "event" && event.payload.kind.startsWith("turn/")) {
      exp.seenTurnEvent = true;
    }
    if (event.type === "state" && event.payload.running) {
      exp.seenRunning = true;
    }
    if (exp.commandType === "send_turn" && exp.seenAck && exp.seenTurnEvent) {
      this.pending.delete(commandId);
    }
    if (exp.commandType === "start" && exp.seenAck && exp.seenRunning) {
      this.pending.delete(commandId);
    }
    if (exp.commandType !== "start" && exp.commandType !== "send_turn" && exp.seenAck) {
      this.pending.delete(commandId);
    }
  }

  poll(now: number, snapshot: BridgeSnapshot): StallSignal[] {
    const out: StallSignal[] = [];
    for (const [id, exp] of this.pending.entries()) {
      if (exp.ackBy && !exp.seenAck && now > exp.ackBy) {
        out.push({
          code: "E_STALL_NO_ACK",
          commandId: id,
          commandType: exp.commandType,
          message: `No ack for command "${exp.commandType}" within timeout.`,
          snapshot,
        });
        this.pending.delete(id);
        continue;
      }
      if (exp.firstTurnEventBy && exp.seenAck && !exp.seenTurnEvent && now > exp.firstTurnEventBy) {
        out.push({
          code: "E_STALL_NO_TURN_EVENTS",
          commandId: id,
          commandType: exp.commandType,
          message: "send_turn acked but no turn/* events arrived.",
          snapshot,
        });
        this.pending.delete(id);
        continue;
      }
      if (exp.runningBy && exp.seenAck && !exp.seenRunning && now > exp.runningBy) {
        out.push({
          code: "E_STALL_THREAD_BINDING",
          commandId: id,
          commandType: exp.commandType,
          message: "start acked but runtime never reported running=true.",
          snapshot,
        });
        this.pending.delete(id);
      }
    }
    return out;
  }
}
