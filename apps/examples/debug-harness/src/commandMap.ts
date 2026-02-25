import type { HelperCommand, StartPayload } from "@zakstam/codex-runtime-bridge-tauri";

export type ParsedCommand =
  | { kind: "helper"; helper: HelperCommand }
  | { kind: "local"; action: "help" | "exit" | "timeline" | "raw" | "save-trace" }
  | { kind: "local"; action: "replay-artifact"; path: string };

function parseJsonOrThrow(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON: ${message}`);
  }
}

export function parseCommand(input: string, defaults: {
  convexUrl: string;
  userId: string;
  sessionId: string;
  cwd?: string;
  model?: string;
}): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: "local", action: "help" };
  }
  const [head, ...rest] = trimmed.split(" ");
  if (head === "help") return { kind: "local", action: "help" };
  if (head === "exit" || head === "quit") return { kind: "local", action: "exit" };
  if (head === "timeline") return { kind: "local", action: "timeline" };
  if (head === "raw") return { kind: "local", action: "raw" };
  if (head === "save-trace") return { kind: "local", action: "save-trace" };
  if (head === "replay-artifact") {
    const path = rest.join(" ").trim();
    if (!path) {
      throw new Error("replay-artifact <path>");
    }
    return { kind: "local", action: "replay-artifact", path };
  }

  if (head === "start") {
    const payload: StartPayload = {
      convexUrl: defaults.convexUrl,
      actor: { userId: defaults.userId },
      sessionId: defaults.sessionId,
      ...(defaults.model ? { model: defaults.model } : {}),
      ...(defaults.cwd ? { cwd: defaults.cwd } : {}),
    };
    return { kind: "helper", helper: { type: "start", payload } };
  }

  if (head === "open-thread") {
    const strategy = rest[0] === "resume" || rest[0] === "fork" || rest[0] === "start"
      ? rest[0]
      : "start";
    const conversationId = strategy !== "start" ? rest[1] : undefined;
    return {
      kind: "helper",
      helper: {
        type: "open_thread",
        payload: {
          strategy,
          ...(conversationId ? { conversationId } : {}),
        },
      },
    };
  }

  if (head === "send") {
    const text = rest.join(" ").trim();
    if (!text) throw new Error("send requires text");
    return { kind: "helper", helper: { type: "send_turn", payload: { text } } };
  }
  if (head === "interrupt") return { kind: "helper", helper: { type: "interrupt" } };
  if (head === "status") return { kind: "helper", helper: { type: "status" } };
  if (head === "stop") return { kind: "helper", helper: { type: "stop" } };

  if (head === "approve-command") {
    const [requestId, decision] = rest;
    if (!requestId || !decision) throw new Error("approve-command <requestId> <decision>");
    return {
      kind: "helper",
      helper: { type: "respond_command_approval", payload: { requestId, decision: decision as never } },
    };
  }

  if (head === "approve-file") {
    const [requestId, decision] = rest;
    if (!requestId || !decision) throw new Error("approve-file <requestId> <decision>");
    return {
      kind: "helper",
      helper: { type: "respond_file_change_approval", payload: { requestId, decision: decision as never } },
    };
  }

  if (head === "tool-input") {
    const requestId = rest[0];
    const json = rest.slice(1).join(" ");
    if (!requestId || !json) throw new Error("tool-input <requestId> <jsonAnswers>");
    const answers = parseJsonOrThrow(json) as Record<string, { answers: string[] }>;
    return {
      kind: "helper",
      helper: { type: "respond_tool_user_input", payload: { requestId, answers } },
    };
  }

  if (head === "account-read") {
    return { kind: "helper", helper: { type: "account_read", payload: { refreshToken: rest[0] === "true" } } };
  }
  if (head === "account-login") {
    const json = rest.join(" ");
    if (!json) throw new Error("account-login <jsonParams>");
    return {
      kind: "helper",
      helper: { type: "account_login_start", payload: { params: parseJsonOrThrow(json) as never } },
    };
  }
  if (head === "account-cancel") {
    const loginId = rest[0];
    if (!loginId) throw new Error("account-cancel <loginId>");
    return { kind: "helper", helper: { type: "account_login_cancel", payload: { loginId } } };
  }
  if (head === "account-logout") {
    return { kind: "helper", helper: { type: "account_logout", payload: {} } };
  }
  if (head === "account-rate-limits") {
    return { kind: "helper", helper: { type: "account_rate_limits_read", payload: {} } };
  }

  if (head === "auth-refresh") {
    const [requestId, accessToken, chatgptAccountId, chatgptPlanType] = rest;
    if (!requestId || !accessToken || !chatgptAccountId) {
      throw new Error("auth-refresh <requestId> <accessToken> <chatgptAccountId> [chatgptPlanType]");
    }
    return {
      kind: "helper",
      helper: {
        type: "respond_chatgpt_auth_tokens_refresh",
        payload: {
          requestId,
          accessToken,
          chatgptAccountId,
          ...(chatgptPlanType ? { chatgptPlanType } : {}),
        },
      },
    };
  }

  if (head === "disable-tools") {
    const tools = rest.join(" ").split(",").map((item) => item.trim()).filter(Boolean);
    return { kind: "helper", helper: { type: "set_disabled_tools", payload: { tools } } };
  }

  throw new Error(`Unknown command: ${head}`);
}
