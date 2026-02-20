import type { HarnessEvent } from "./eventModel.js";

export class Timeline {
  private readonly events: HarnessEvent[] = [];

  add(event: HarnessEvent): void {
    this.events.push(event);
  }

  list(limit = 50): HarnessEvent[] {
    return this.events.slice(Math.max(0, this.events.length - limit));
  }

  all(): HarnessEvent[] {
    return [...this.events];
  }

  print(limit = 50): void {
    for (const event of this.list(limit)) {
      const ts = new Date(event.ts).toISOString();
      const corr = event.correlatedCommandId ? ` #${event.correlatedCommandId}` : "";
      const payload = typeof event.payload === "string"
        ? event.payload
        : JSON.stringify(event.payload);
      // Keep output compact for interactive debugging.
      console.log(`${ts} [${event.source}] ${event.label}${corr} ${payload}`);
    }
  }
}
