import type { CommandExecutionApprovalDecision } from "../protocol/schemas/v2/CommandExecutionApprovalDecision.js";
import type { FileChangeApprovalDecision } from "../protocol/schemas/v2/FileChangeApprovalDecision.js";
import type { LoginAccountParams as ProtocolLoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";
import type { ToolRequestUserInputAnswer } from "../protocol/schemas/v2/ToolRequestUserInputAnswer.js";
import type { DynamicToolSpec } from "../protocol/schemas/v2/DynamicToolSpec.js";
import type { ThreadHandle } from "../shared/threadIdentity.js";
import { canonicalizeSnapshotItemId } from "./snapshotIdentity.js";

export type { LoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";

export type ActorContext = { userId?: string };

export type BridgeState = {
  running: boolean;
  phase?: "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
  source?: "runtime" | "bridge_event" | "protocol_error" | "process_exit";
  updatedAtMs?: number;
  runtimeConversationId: string | null;
  conversationId: string | null;
  turnId: string | null;
  lastErrorCode?: string | null;
  lastError: string | null;
  disabledTools?: string[];
  pendingServerRequestCount?: number | null;
  ingestEnqueuedEventCount?: number | null;
  ingestSkippedEventCount?: number | null;
  ingestEnqueuedByKind?: Array<{ kind: string; count: number }> | null;
  ingestSkippedByKind?: Array<{ kind: string; count: number }> | null;
};

export type TauriSyncHydrationState =
  | "idle"
  | "syncing"
  | "synced"
  | "partial"
  | "drifted"
  | "cancelled"
  | "failed";

export type TauriSyncJobState =
  | "idle"
  | "syncing"
  | "synced"
  | "failed"
  | "cancelled";

export type TauriSyncHydrationMessage = {
  messageId: string;
  turnId: string;
  role: "user" | "assistant" | "system" | "tool";
  status: "streaming" | "completed" | "failed" | "interrupted";
  sourceItemType?: string;
  text: string;
  orderInTurn: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
};

export type TauriSyncHydrationSnapshot = {
  conversationId: string;
  messages: TauriSyncHydrationMessage[];
  syncState: TauriSyncHydrationState;
  updatedAtMs: number;
  syncJobId?: string;
  syncJobState?: TauriSyncJobState;
  syncJobPolicyVersion?: number;
  lastCursor?: number;
  errorCode?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSnapshotItemType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function messageTextFromSnapshotItem(item: Record<string, unknown>): string {
  const directText = typeof item.text === "string" ? item.text : null;
  if (directText && directText.length > 0) {
    return directText;
  }
  const content = Array.isArray(item.content) ? item.content : [];
  const chunks: string[] = [];
  for (const entry of content) {
    if (!isRecord(entry)) {
      continue;
    }
    const text = typeof entry.text === "string" ? entry.text : null;
    if (text && text.length > 0) {
      chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

function toHydrationStatus(value: unknown): "streaming" | "completed" | "failed" | "interrupted" {
  if (value === "inProgress") {
    return "streaming";
  }
  if (value === "failed" || value === "interrupted") {
    return value;
  }
  return "completed";
}

export function parseThreadReadSnapshotMessages(response: unknown): TauriSyncHydrationMessage[] {
  const root = isRecord(response) ? response : null;
  const result = isRecord(root?.result) ? root.result : null;
  const thread = isRecord(result?.thread) ? result.thread : null;
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const messages: TauriSyncHydrationMessage[] = [];
  let timestampCursor = Date.now();

  for (const turnValue of turns) {
    const turn = isRecord(turnValue) ? turnValue : null;
    const turnId = typeof turn?.id === "string" ? turn.id : null;
    if (!turnId) {
      continue;
    }
    const status = toHydrationStatus(turn?.status);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    let orderInTurn = 0;

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const itemValue = items[itemIndex];
      const item = isRecord(itemValue) ? itemValue : null;
      const itemType = normalizeSnapshotItemType(item?.type);
      if (!item || !itemType) {
        continue;
      }
      const itemId = canonicalizeSnapshotItemId({ turnId, item, itemIndex }).messageId;
      const text = messageTextFromSnapshotItem(item);
      if (itemType === "usermessage" || itemType === "user_message") {
        messages.push({
          messageId: itemId,
          turnId,
          role: "user",
          status: "completed",
          sourceItemType: "userMessage",
          text,
          orderInTurn,
          createdAt: timestampCursor,
          updatedAt: timestampCursor,
          completedAt: timestampCursor,
        });
        timestampCursor += 1;
        orderInTurn += 1;
        continue;
      }
      if (itemType === "assistantmessage" || itemType === "agentmessage" || itemType === "assistant_message" || itemType === "agent_message") {
        messages.push({
          messageId: itemId,
          turnId,
          role: "assistant",
          status,
          sourceItemType: "agentMessage",
          text,
          orderInTurn,
          createdAt: timestampCursor,
          updatedAt: timestampCursor,
          ...(status === "completed" ? { completedAt: timestampCursor } : {}),
        });
        timestampCursor += 1;
        orderInTurn += 1;
        continue;
      }
      if (itemType === "systemmessage" || itemType === "system_message") {
        messages.push({
          messageId: itemId,
          turnId,
          role: "system",
          status: "completed",
          sourceItemType: "systemMessage",
          text,
          orderInTurn,
          createdAt: timestampCursor,
          updatedAt: timestampCursor,
          completedAt: timestampCursor,
        });
        timestampCursor += 1;
        orderInTurn += 1;
        continue;
      }
      if (itemType === "toolmessage" || itemType === "tool_message") {
        messages.push({
          messageId: itemId,
          turnId,
          role: "tool",
          status: "completed",
          sourceItemType: "toolMessage",
          text,
          orderInTurn,
          createdAt: timestampCursor,
          updatedAt: timestampCursor,
          completedAt: timestampCursor,
        });
        timestampCursor += 1;
        orderInTurn += 1;
      }
    }
  }

  return messages;
}

export type CommandApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
export type ToolUserInputAnswer = { answers: string[] };

export type StartBridgeConfig = {
  convexUrl: string;
  actor: ActorContext;
  sessionId: string;
  startSource?: string;
  model?: string;
  cwd?: string;
  disabledTools?: string[];
  deltaThrottleMs?: number;
  saveStreamDeltas?: boolean;
};

export type StartPayload = {
  convexUrl: string;
  actor: ActorContext;
  sessionId: string;
  model?: string;
  cwd?: string;
  disabledTools?: string[];
  deltaThrottleMs?: number;
  saveStreamDeltas?: boolean;
};

export type OpenThreadConfig = {
  strategy: "start" | "resume" | "fork";
  conversationId?: ThreadHandle;
  model?: string;
  cwd?: string;
  dynamicTools?: DynamicToolSpec[];
};

export type OpenThreadPayload = {
  strategy: "start" | "resume" | "fork";
  conversationId?: ThreadHandle;
  model?: string;
  cwd?: string;
  dynamicTools?: DynamicToolSpec[];
};

export type HelperCommandType =
  | "start"
  | "open_thread"
  | "refresh_local_threads"
  | "send_turn"
  | "interrupt"
  | "respond_command_approval"
  | "respond_file_change_approval"
  | "respond_tool_user_input"
  | "account_read"
  | "account_login_start"
  | "account_login_cancel"
  | "account_logout"
  | "account_rate_limits_read"
  | "respond_chatgpt_auth_tokens_refresh"
  | "set_disabled_tools"
  | "stop"
  | "status";

export type HelperCommand =
  | { type: "start"; payload: StartPayload }
  | { type: "open_thread"; payload: OpenThreadPayload }
  | { type: "refresh_local_threads"; payload: Record<string, never> }
  | { type: "send_turn"; payload: { text: string } }
  | { type: "interrupt" }
  | { type: "respond_command_approval"; payload: { requestId: string | number; decision: CommandExecutionApprovalDecision } }
  | { type: "respond_file_change_approval"; payload: { requestId: string | number; decision: FileChangeApprovalDecision } }
  | { type: "respond_tool_user_input"; payload: { requestId: string | number; answers: Record<string, ToolRequestUserInputAnswer> } }
  | { type: "account_read"; payload: { refreshToken?: boolean } }
  | { type: "account_login_start"; payload: { params: ProtocolLoginAccountParams } }
  | { type: "account_login_cancel"; payload: { loginId: string } }
  | { type: "account_logout"; payload: Record<string, never> }
  | { type: "account_rate_limits_read"; payload: Record<string, never> }
  | {
      type: "respond_chatgpt_auth_tokens_refresh";
      payload: {
        requestId: string | number;
        accessToken: string;
        chatgptAccountId: string;
        chatgptPlanType?: string | null;
      };
    }
  | { type: "set_disabled_tools"; payload: { tools: string[] } }
  | { type: "stop" }
  | { type: "status" };

type TauriBridgeCommandDefinition = {
  id: string;
  helperType?: HelperCommandType;
  tauriCommand?: string;
  permission?: boolean;
  ack?: boolean;
};

export const TAURI_BRIDGE_COMMANDS: ReadonlyArray<TauriBridgeCommandDefinition> = [
  { id: "start_bridge", tauriCommand: "start_bridge", helperType: "start", permission: true, ack: false },
  { id: "open_thread", tauriCommand: "open_thread", helperType: "open_thread", permission: true, ack: true },
  {
    id: "refresh_local_threads",
    tauriCommand: "refresh_local_threads",
    helperType: "refresh_local_threads",
    permission: true,
    ack: true,
  },
  { id: "send_user_turn", tauriCommand: "send_user_turn", helperType: "send_turn", permission: true, ack: true },
  { id: "interrupt_turn", tauriCommand: "interrupt_turn", helperType: "interrupt", permission: true, ack: true },
  {
    id: "respond_command_approval",
    tauriCommand: "respond_command_approval",
    helperType: "respond_command_approval",
    permission: true,
    ack: true,
  },
  {
    id: "respond_file_change_approval",
    tauriCommand: "respond_file_change_approval",
    helperType: "respond_file_change_approval",
    permission: true,
    ack: true,
  },
  {
    id: "respond_tool_user_input",
    tauriCommand: "respond_tool_user_input",
    helperType: "respond_tool_user_input",
    permission: true,
    ack: true,
  },
  { id: "read_account", tauriCommand: "read_account", helperType: "account_read", permission: true, ack: true },
  {
    id: "login_account",
    tauriCommand: "login_account",
    helperType: "account_login_start",
    permission: true,
    ack: true,
  },
  {
    id: "cancel_account_login",
    tauriCommand: "cancel_account_login",
    helperType: "account_login_cancel",
    permission: true,
    ack: true,
  },
  { id: "logout_account", tauriCommand: "logout_account", helperType: "account_logout", permission: true, ack: true },
  {
    id: "read_account_rate_limits",
    tauriCommand: "read_account_rate_limits",
    helperType: "account_rate_limits_read",
    permission: true,
    ack: true,
  },
  {
    id: "respond_chatgpt_auth_tokens_refresh",
    tauriCommand: "respond_chatgpt_auth_tokens_refresh",
    helperType: "respond_chatgpt_auth_tokens_refresh",
    permission: true,
    ack: true,
  },
  {
    id: "set_disabled_tools",
    tauriCommand: "set_disabled_tools",
    helperType: "set_disabled_tools",
    permission: true,
    ack: true,
  },
  { id: "stop_bridge", tauriCommand: "stop_bridge", helperType: "stop", permission: true, ack: false },
  { id: "get_bridge_state", tauriCommand: "get_bridge_state", permission: true },
  { id: "helper_status", helperType: "status", ack: true },
];

export const HELPER_COMMAND_TYPES = TAURI_BRIDGE_COMMANDS
  .map((command) => command.helperType)
  .filter((helperType): helperType is HelperCommandType => typeof helperType === "string");

export const HELPER_ACK_BY_TYPE: Readonly<Record<HelperCommandType, boolean>> = Object.freeze({
  start: false,
  open_thread: true,
  refresh_local_threads: true,
  send_turn: true,
  interrupt: true,
  respond_command_approval: true,
  respond_file_change_approval: true,
  respond_tool_user_input: true,
  account_read: true,
  account_login_start: true,
  account_login_cancel: true,
  account_logout: true,
  account_rate_limits_read: true,
  respond_chatgpt_auth_tokens_refresh: true,
  set_disabled_tools: true,
  stop: false,
  status: true,
});

const HELPER_COMMAND_TYPE_SET = new Set<HelperCommandType>(HELPER_COMMAND_TYPES);

const TAURI_TO_HELPER_COMMAND: Readonly<Record<string, HelperCommandType>> = Object.freeze(
  TAURI_BRIDGE_COMMANDS.reduce<Record<string, HelperCommandType>>((acc, command) => {
    if (typeof command.tauriCommand === "string" && typeof command.helperType === "string") {
      acc[command.tauriCommand] = command.helperType;
    }
    return acc;
  }, {}),
);

export function helperCommandForTauriCommand(tauriCommand: string): HelperCommandType | null {
  return TAURI_TO_HELPER_COMMAND[tauriCommand] ?? null;
}

export function parseHelperCommand(line: string): HelperCommand {
  const parsed = JSON.parse(line) as { type?: unknown; payload?: unknown };
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Helper command must be an object.");
  }
  if (typeof parsed.type !== "string" || !HELPER_COMMAND_TYPE_SET.has(parsed.type as HelperCommandType)) {
    throw new Error(`Unsupported helper command: ${String(parsed.type)}`);
  }
  if (parsed.type === "interrupt" || parsed.type === "stop" || parsed.type === "status") {
    return { type: parsed.type } as HelperCommand;
  }
  if (!("payload" in parsed)) {
    throw new Error(`Missing payload for helper command: ${parsed.type}`);
  }
  return parsed as HelperCommand;
}

export type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type TauriBridgeStateListener = (state: BridgeState) => void;
export type TauriBridgeStateSubscribe = (listener: TauriBridgeStateListener) => Promise<() => void>;
export type TauriGlobalMessageSubscribe = (
  listener: (payload: Record<string, unknown>) => void,
) => Promise<() => void>;
export type TauriBridgeClientOptions = {
  subscribeBridgeState?: TauriBridgeStateSubscribe;
  subscribeGlobalMessage?: TauriGlobalMessageSubscribe;
  lifecycleSafeSend?: boolean;
};

export type TauriBridgeClientSendErrorCode =
  | "E_TAURI_SEND_START_CONFIG_MISSING"
  | "E_TAURI_SEND_AUTO_START_FAILED"
  | "E_TAURI_SEND_RETRY_EXHAUSTED";

export class TauriBridgeClientSendError extends Error {
  readonly code: TauriBridgeClientSendErrorCode;
  declare readonly cause: unknown;

  constructor(code: TauriBridgeClientSendErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}`, cause === undefined ? undefined : { cause });
    this.name = "TauriBridgeClientSendError";
    this.code = code;
  }
}

export type TauriBridgeClient = {
  lifecycle: {
    start(config: StartBridgeConfig): Promise<unknown>;
    openThread(config: OpenThreadConfig): Promise<unknown>;
    refreshLocalThreads(): Promise<unknown>;
    stop(): Promise<unknown>;
    getState(): Promise<BridgeState>;
    subscribe(listener: TauriBridgeStateListener): Promise<() => void>;
  };
  turns: {
    send(text: string): Promise<unknown>;
    interrupt(): Promise<unknown>;
  };
  approvals: {
    respondCommand(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown>;
    respondFileChange(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown>;
    respondToolInput(config: { requestId: string | number; answers: Record<string, ToolUserInputAnswer> }): Promise<unknown>;
  };
  account: {
    read(config?: { refreshToken?: boolean }): Promise<unknown>;
    login(config: { params: ProtocolLoginAccountParams }): Promise<unknown>;
    cancelLogin(config: { loginId: string }): Promise<unknown>;
    logout(): Promise<unknown>;
    readRateLimits(): Promise<unknown>;
    respondChatgptAuthTokensRefresh(config: {
      requestId: string | number;
      accessToken: string;
      chatgptAccountId: string;
      chatgptPlanType?: string | null;
    }): Promise<unknown>;
  };
  tools: {
    setDisabled(config: { tools: string[] }): Promise<unknown>;
  };
  syncHydration: {
    getConversationSnapshot(
      conversationId: string,
    ): TauriSyncHydrationSnapshot | null | Promise<TauriSyncHydrationSnapshot | null>;
    subscribe(listener: (snapshot: TauriSyncHydrationSnapshot) => void): Promise<() => void>;
  };
};

type SyncDebugPayload = Record<string, unknown>;

function syncDebugEnabled(): boolean {
  const debugFlag = Reflect.get(globalThis as Record<string, unknown>, "__CODEX_SYNC_DEBUG__");
  return debugFlag === true;
}

function syncDebugLog(message: string, payload?: SyncDebugPayload): void {
  if (!syncDebugEnabled()) {
    return;
  }
  const data = payload ? { ...payload } : {};
  console.debug("[codex-sync-debug]", { message, ...data });
}

const LIFECYCLE_SAFE_SEND_READY_TIMEOUT_MS = 8_000;
const LIFECYCLE_SAFE_SEND_POLL_MS = 200;

function isBridgeReadyForTurnSend(state: BridgeState): boolean {
  return (
    state.running === true
    && (
      (typeof state.conversationId === "string" && state.conversationId.length > 0)
      || (typeof state.runtimeConversationId === "string" && state.runtimeConversationId.length > 0)
    )
  );
}

function toBridgeStartInvokeConfig(config: StartBridgeConfig): Record<string, unknown> {
  return { ...config };
}

function toOpenThreadInvokeConfig(config: OpenThreadConfig): Record<string, unknown> {
  return { ...config };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLifecycleTransientSendError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("bridge helper is not running. Start runtime first.")
    || message.includes("Bridge/runtime not ready. Start runtime first.")
    || message.includes("Cannot dispatch turn before runtime thread is ready.")
    || message.includes("failed to write command")
    || message.includes("failed to write newline")
    || message.includes("failed to flush helper stdin")
    || message.includes("Broken pipe")
  );
}

function parseSyncHydrationState(value: unknown): TauriSyncHydrationState | null {
  if (
    value === "idle" ||
    value === "syncing" ||
    value === "synced" ||
    value === "partial" ||
    value === "drifted" ||
    value === "cancelled" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

function parseSyncJobState(value: unknown): TauriSyncJobState | null {
  if (
    value === "idle" ||
    value === "syncing" ||
    value === "synced" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

function parseSyncHydrationMessage(value: unknown): TauriSyncHydrationMessage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const messageId = Reflect.get(value, "messageId");
  const turnId = Reflect.get(value, "turnId");
  const role = Reflect.get(value, "role");
  const status = Reflect.get(value, "status");
  const text = Reflect.get(value, "text");
  const orderInTurn = Reflect.get(value, "orderInTurn");
  const createdAt = Reflect.get(value, "createdAt");
  const updatedAt = Reflect.get(value, "updatedAt");
  if (
    typeof messageId !== "string" ||
    typeof turnId !== "string" ||
    (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") ||
    (status !== "streaming" && status !== "completed" && status !== "failed" && status !== "interrupted") ||
    typeof text !== "string" ||
    typeof orderInTurn !== "number" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number"
  ) {
    return null;
  }
  const sourceItemType = Reflect.get(value, "sourceItemType");
  const completedAt = Reflect.get(value, "completedAt");
  const error = Reflect.get(value, "error");
  return {
    messageId,
    turnId,
    role,
    status,
    ...(typeof sourceItemType === "string" ? { sourceItemType } : {}),
    text,
    orderInTurn,
    createdAt,
    updatedAt,
    ...(typeof completedAt === "number" ? { completedAt } : {}),
    ...(typeof error === "string" ? { error } : {}),
  };
}

function parseSyncHydrationSnapshot(payload: Record<string, unknown>): TauriSyncHydrationSnapshot | null {
  const conversationId = Reflect.get(payload, "conversationId");
  const syncState = parseSyncHydrationState(Reflect.get(payload, "syncState"));
  const updatedAtMs = Reflect.get(payload, "updatedAtMs");
  const messages = Reflect.get(payload, "messages");
  if (
    typeof conversationId !== "string" ||
    !syncState ||
    typeof updatedAtMs !== "number" ||
    !Array.isArray(messages)
  ) {
    return null;
  }
  const parsedMessages = messages
    .map((message) => parseSyncHydrationMessage(message))
    .filter((message): message is TauriSyncHydrationMessage => message !== null);
  const errorCode = Reflect.get(payload, "errorCode");
  const syncJobId = Reflect.get(payload, "syncJobId");
  const syncJobState = parseSyncJobState(Reflect.get(payload, "syncJobState"));
  const syncJobPolicyVersion = Reflect.get(payload, "syncJobPolicyVersion");
  const lastCursor = Reflect.get(payload, "lastCursor");
  return {
    conversationId,
    syncState,
    updatedAtMs,
    messages: parsedMessages,
    ...(typeof syncJobId === "string" ? { syncJobId } : {}),
    ...(syncJobState ? { syncJobState } : {}),
    ...(typeof syncJobPolicyVersion === "number" ? { syncJobPolicyVersion } : {}),
    ...(typeof lastCursor === "number" ? { lastCursor } : {}),
    ...(typeof errorCode === "string" ? { errorCode } : {}),
  };
}

export function createTauriBridgeClient(invoke: TauriInvoke, options?: TauriBridgeClientOptions): TauriBridgeClient {
  let cachedStartConfig: StartBridgeConfig | null = null;
  const syncHydrationByConversationId = new Map<string, TauriSyncHydrationSnapshot>();
  const syncHydrationListeners = new Set<(snapshot: TauriSyncHydrationSnapshot) => void>();
  let globalMessageSubscribed = false;
  let globalMessageUnsubscribe: (() => void) | null = null;

  const emitSyncHydrationSnapshot = (snapshot: TauriSyncHydrationSnapshot): void => {
    const existing = syncHydrationByConversationId.get(snapshot.conversationId);
    if (existing) {
      const existingJobId = existing.syncJobId;
      const incomingJobId = snapshot.syncJobId;
      if (
        typeof existingJobId === "string" &&
        typeof incomingJobId === "string" &&
        existingJobId !== incomingJobId &&
        existing.syncState === "syncing" &&
        snapshot.syncState !== "syncing"
      ) {
        syncDebugLog("drop_snapshot_stale_job_terminal", {
          conversationId: snapshot.conversationId,
          existingJobId,
          incomingJobId,
          existingSyncState: existing.syncState,
          incomingSyncState: snapshot.syncState,
          existingUpdatedAtMs: existing.updatedAtMs,
          incomingUpdatedAtMs: snapshot.updatedAtMs,
        });
        return;
      }
      if (snapshot.updatedAtMs < existing.updatedAtMs) {
        syncDebugLog("drop_snapshot_stale_timestamp", {
          conversationId: snapshot.conversationId,
          existingJobId,
          incomingJobId,
          existingUpdatedAtMs: existing.updatedAtMs,
          incomingUpdatedAtMs: snapshot.updatedAtMs,
          existingSyncState: existing.syncState,
          incomingSyncState: snapshot.syncState,
        });
        return;
      }
    }
    syncHydrationByConversationId.set(snapshot.conversationId, snapshot);
    syncDebugLog("accept_snapshot", {
      conversationId: snapshot.conversationId,
      syncJobId: snapshot.syncJobId ?? null,
      syncJobState: snapshot.syncJobState ?? null,
      syncState: snapshot.syncState,
      updatedAtMs: snapshot.updatedAtMs,
      localMessageCount: snapshot.messages.length,
      lastCursor: snapshot.lastCursor ?? null,
      errorCode: snapshot.errorCode ?? null,
    });
    for (const listener of syncHydrationListeners) {
      listener(snapshot);
    }
  };

  const ensureGlobalMessageSubscription = async (): Promise<void> => {
    if (globalMessageSubscribed) {
      return;
    }
    if (!options?.subscribeGlobalMessage) {
      throw new Error("Global message subscription is not configured for this client.");
    }
    const unsubscribe = await options.subscribeGlobalMessage((payload) => {
      const kind = Reflect.get(payload, "kind");
      if (kind === "bridge/sync_hydration_snapshot") {
        const snapshot = parseSyncHydrationSnapshot(payload);
        if (snapshot) {
          emitSyncHydrationSnapshot(snapshot);
        } else {
          syncDebugLog("ignore_invalid_sync_hydration_snapshot_payload", { payload });
        }
        return;
      }
      if (kind === "bridge/sync_hydration_state") {
        const conversationId = Reflect.get(payload, "conversationId");
        const syncState = parseSyncHydrationState(Reflect.get(payload, "syncState"));
        if (typeof conversationId !== "string" || !syncState) {
          return;
        }
        const existing = syncHydrationByConversationId.get(conversationId);
        const updatedAtCandidate = Reflect.get(payload, "updatedAtMs");
        const updatedAtMs = typeof updatedAtCandidate === "number"
          ? updatedAtCandidate
          : Date.now();
        const errorCode = Reflect.get(payload, "errorCode");
        const terminalSynced = syncState === "synced";
        syncDebugLog("receive_sync_hydration_state", {
          conversationId,
          syncState,
          syncJobId: Reflect.get(payload, "syncJobId") ?? existing?.syncJobId ?? null,
          syncJobState: Reflect.get(payload, "syncJobState") ?? existing?.syncJobState ?? null,
          updatedAtMs,
          terminalSynced,
          existingMessageCount: existing?.messages.length ?? 0,
        });
        emitSyncHydrationSnapshot({
          conversationId,
          messages: existing?.messages ?? [],
          syncState,
          updatedAtMs,
          ...(typeof Reflect.get(payload, "syncJobId") === "string"
            ? { syncJobId: Reflect.get(payload, "syncJobId") as string }
            : existing?.syncJobId !== undefined
              ? { syncJobId: existing.syncJobId }
              : {}),
          ...(parseSyncJobState(Reflect.get(payload, "syncJobState"))
            ? { syncJobState: parseSyncJobState(Reflect.get(payload, "syncJobState")) as TauriSyncJobState }
            : existing?.syncJobState !== undefined
              ? { syncJobState: existing.syncJobState }
              : {}),
          ...(typeof Reflect.get(payload, "syncJobPolicyVersion") === "number"
            ? { syncJobPolicyVersion: Reflect.get(payload, "syncJobPolicyVersion") as number }
            : existing?.syncJobPolicyVersion !== undefined
              ? { syncJobPolicyVersion: existing.syncJobPolicyVersion }
              : {}),
          ...(typeof Reflect.get(payload, "lastCursor") === "number"
            ? { lastCursor: Reflect.get(payload, "lastCursor") as number }
            : existing?.lastCursor !== undefined
              ? { lastCursor: existing.lastCursor }
              : {}),
          ...(typeof errorCode === "string" ? { errorCode } : {}),
        });
      }
    });
    globalMessageUnsubscribe = unsubscribe;
    globalMessageSubscribed = true;
  };

  const getState = (): Promise<BridgeState> => invoke("get_bridge_state");
  const start = (config: StartBridgeConfig): Promise<unknown> => {
    cachedStartConfig = { ...config };
    return invoke("start_bridge", { config: toBridgeStartInvokeConfig(config) });
  };
  const waitForReady = async (): Promise<void> => {
    const deadline = Date.now() + LIFECYCLE_SAFE_SEND_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await getState();
      if (isBridgeReadyForTurnSend(state)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, LIFECYCLE_SAFE_SEND_POLL_MS));
    }
    throw new Error(`Bridge started, but no conversation became ready within ${LIFECYCLE_SAFE_SEND_READY_TIMEOUT_MS}ms.`);
  };
  const ensureReadyForLifecycleSafeSend = async (): Promise<void> => {
    if (!cachedStartConfig) {
      throw new TauriBridgeClientSendError(
        "E_TAURI_SEND_START_CONFIG_MISSING",
        "Cannot auto-start for send: call lifecycle.start(...) at least once to cache transport config.",
      );
    }
    try {
      await start(cachedStartConfig);
      await waitForReady();
    } catch (error) {
      throw new TauriBridgeClientSendError(
        "E_TAURI_SEND_AUTO_START_FAILED",
        `Lifecycle-safe send could not auto-start the bridge: ${errorMessage(error)}`,
        error,
      );
    }
  };
  const sendTurnWithLifecycleRecovery = async (text: string): Promise<unknown> => {
    try {
      return await invoke("send_user_turn", { text });
    } catch (firstError) {
      if (!isLifecycleTransientSendError(firstError)) {
        throw firstError;
      }
      await ensureReadyForLifecycleSafeSend();
      try {
        return await invoke("send_user_turn", { text });
      } catch (secondError) {
        if (!isLifecycleTransientSendError(secondError)) {
          throw secondError;
        }
        throw new TauriBridgeClientSendError(
          "E_TAURI_SEND_RETRY_EXHAUSTED",
          `Lifecycle-safe send failed after one retry: ${errorMessage(secondError)}`,
          secondError,
        );
      }
    }
  };

  return {
    lifecycle: {
      start(config: StartBridgeConfig): Promise<unknown> {
        return start(config);
      },
      openThread(config: OpenThreadConfig): Promise<unknown> {
        return invoke("open_thread", { config: toOpenThreadInvokeConfig(config) });
      },
      refreshLocalThreads(): Promise<unknown> {
        return invoke("refresh_local_threads");
      },
      stop(): Promise<unknown> {
        return invoke("stop_bridge");
      },
      getState(): Promise<BridgeState> {
        return getState();
      },
      subscribe(listener: TauriBridgeStateListener): Promise<() => void> {
        if (!options?.subscribeBridgeState) {
          throw new Error("Bridge lifecycle subscription is not configured for this client.");
        }
        return options.subscribeBridgeState(listener);
      },
    },
    turns: {
      send(text: string): Promise<unknown> {
        if (options?.lifecycleSafeSend) {
          return sendTurnWithLifecycleRecovery(text);
        }
        return invoke("send_user_turn", { text });
      },
      interrupt(): Promise<unknown> {
        return invoke("interrupt_turn");
      },
    },
    approvals: {
      respondCommand(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown> {
        return invoke("respond_command_approval", { config });
      },
      respondFileChange(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown> {
        return invoke("respond_file_change_approval", { config });
      },
      respondToolInput(config: { requestId: string | number; answers: Record<string, ToolUserInputAnswer> }): Promise<unknown> {
        return invoke("respond_tool_user_input", { config });
      },
    },
    account: {
      read(config?: { refreshToken?: boolean }): Promise<unknown> {
        return invoke("read_account", { config: config ?? {} });
      },
      login(config: { params: ProtocolLoginAccountParams }): Promise<unknown> {
        return invoke("login_account", { config });
      },
      cancelLogin(config: { loginId: string }): Promise<unknown> {
        return invoke("cancel_account_login", { config });
      },
      logout(): Promise<unknown> {
        return invoke("logout_account");
      },
      readRateLimits(): Promise<unknown> {
        return invoke("read_account_rate_limits");
      },
      respondChatgptAuthTokensRefresh(config: {
        requestId: string | number;
        accessToken: string;
        chatgptAccountId: string;
        chatgptPlanType?: string | null;
      }): Promise<unknown> {
        return invoke("respond_chatgpt_auth_tokens_refresh", { config });
      },
    },
    tools: {
      setDisabled(config: { tools: string[] }): Promise<unknown> {
        return invoke("set_disabled_tools", { config });
      },
    },
    syncHydration: {
      async getConversationSnapshot(conversationId: string): Promise<TauriSyncHydrationSnapshot | null> {
        if (options?.subscribeGlobalMessage) {
          await ensureGlobalMessageSubscription();
        }
        const key = conversationId.trim();
        if (!key) {
          return null;
        }
        return syncHydrationByConversationId.get(key) ?? null;
      },
      async subscribe(listener: (snapshot: TauriSyncHydrationSnapshot) => void): Promise<() => void> {
        await ensureGlobalMessageSubscription();
        syncHydrationListeners.add(listener);
        return () => {
          syncHydrationListeners.delete(listener);
          if (syncHydrationListeners.size === 0 && globalMessageUnsubscribe) {
            globalMessageUnsubscribe();
            globalMessageUnsubscribe = null;
            globalMessageSubscribed = false;
          }
        };
      },
    },
  };
}

function toKebabCase(value: string): string {
  return value.replaceAll("_", "-");
}

export type TauriGeneratedPermissionFile = {
  filename: string;
  contents: string;
};

export type TauriGeneratedArtifacts = {
  rustContractSource: string;
  rustDispatchSource: string;
  rustInvokeHandlersSource: string;
  permissionFiles: TauriGeneratedPermissionFile[];
};

export function generateTauriArtifacts(): TauriGeneratedArtifacts {
  const tauriCommands = TAURI_BRIDGE_COMMANDS.filter(
    (command): command is TauriBridgeCommandDefinition & { tauriCommand: string } =>
      typeof command.tauriCommand === "string",
  );
  const helperCommands = HELPER_COMMAND_TYPES;

  const rustContractSource = `${[
    "// AUTO-GENERATED FILE. DO NOT EDIT.",
    "// Source: @zakstam/codex-local-component/host/tauri",
    "pub const BRIDGE_COMMANDS: &[&str] = &[",
    ...tauriCommands.map((command) => `    \"${command.tauriCommand}\",`),
    "];",
    "",
    "pub const HELPER_COMMANDS: &[&str] = &[",
    ...helperCommands.map((command) => `    \"${command}\",`),
    "];",
    "",
  ].join("\n")}`;

  const rustDispatchSource = `${[
    "// AUTO-GENERATED FILE. DO NOT EDIT.",
    "// Source: @zakstam/codex-local-component/host/tauri",
    "",
    "pub const HELPER_FORWARD_TAURI_COMMANDS: &[&str] = &[",
    ...tauriCommands
      .filter((command) => typeof command.helperType === "string")
      .map((command) => `    \"${command.tauriCommand}\",`),
    "];",
    "",
    "pub fn helper_command_for_tauri_command(tauri_command: &str) -> Option<&'static str> {",
    "    match tauri_command {",
    ...tauriCommands
      .filter((command) => typeof command.helperType === "string")
      .map((command) => `        \"${command.tauriCommand}\" => Some(\"${command.helperType}\"),`),
    "        _ => None,",
    "    }",
    "}",
    "",
  ].join("\n")}`;

  const rustInvokeHandlersSource = `${[
    "// AUTO-GENERATED FILE. DO NOT EDIT.",
    "// Source: @zakstam/codex-local-component/host/tauri",
    "",
    "macro_rules! bridge_generate_handler {",
    "    () => {",
    "        tauri::generate_handler![",
    ...tauriCommands.map((command) => `            ${command.tauriCommand},`),
    "        ]",
    "    };",
    "}",
    "",
  ].join("\n")}`;

  const permissionFiles = tauriCommands
    .filter((command) => command.permission === true)
    .map((command) => {
      const id = toKebabCase(command.tauriCommand);
      return {
        filename: `${command.tauriCommand}.toml`,
        contents: `${[
          "# Automatically generated - DO NOT EDIT!",
          "",
          "[[permission]]",
          `identifier = \"allow-${id}\"`,
          `description = \"Enables the ${command.tauriCommand} command without a pre-configured scope.\"`,
          `commands.allow = [\"${command.tauriCommand}\"]`,
          "",
          "[[permission]]",
          `identifier = \"deny-${id}\"`,
          `description = \"Denies the ${command.tauriCommand} command without a pre-configured scope.\"`,
          `commands.deny = [\"${command.tauriCommand}\"]`,
          "",
        ].join("\n")}`,
      };
    });

  return {
    rustContractSource,
    rustDispatchSource,
    rustInvokeHandlersSource,
    permissionFiles,
  };
}
