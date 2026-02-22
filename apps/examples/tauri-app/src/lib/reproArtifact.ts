export type TauriReproCaptureCommand = {
  tsMs: number;
  phase: "invoke_start" | "invoke_success" | "invoke_error";
  command: string;
  args?: unknown;
  result?: unknown;
  error?: string;
};

export type TauriReproObservedEvent = {
  tsMs: number;
  kind: "bridge_state" | "codex_event" | "codex_global_message" | "codex_protocol_error";
  payload: unknown;
};

export type TauriReproDiagnostics = {
  errorClasses: string[];
};

export type TauriReproArtifactV1 = {
  version: "tauri-repro-v1";
  createdAtMs: number;
  redaction: {
    messageTextRedacted: boolean;
  };
  env: {
    userAgent: string;
    runtimeMode: string;
    convexUrlHost?: string;
  };
  commands: TauriReproCaptureCommand[];
  observed: TauriReproObservedEvent[];
  diagnostics: TauriReproDiagnostics;
};

export function classifyReproErrorClasses(
  commands: TauriReproCaptureCommand[],
  observed: TauriReproObservedEvent[],
): string[] {
  const out = new Set<string>();
  for (const command of commands) {
    if (command.phase !== "invoke_error") {
      continue;
    }
    const message = (command.error ?? "").toLowerCase();
    if (message.includes("too many documents read")) {
      out.add("ingest.documents_read_limit");
    } else {
      out.add("invoke.error");
    }
  }
  for (const event of observed) {
    if (event.kind === "codex_protocol_error") {
      const msg = JSON.stringify(event.payload).toLowerCase();
      if (msg.includes("failed to parse")) {
        out.add("protocol.parse_error");
      } else if (msg.includes("too many documents read")) {
        out.add("ingest.documents_read_limit");
      } else {
        out.add("protocol.error");
      }
    }
    if (event.kind === "codex_global_message") {
      const json = JSON.stringify(event.payload).toLowerCase();
      if (json.includes("e_stall_no_ack")) {
        out.add("stall.no_ack");
      }
      if (json.includes("e_stall_no_turn_events")) {
        out.add("stall.no_turn_events");
      }
      if (json.includes("e_stall_thread_binding")) {
        out.add("stall.thread_binding");
      }
    }
  }
  return [...out].sort();
}
