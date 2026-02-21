"use client";

// ── Primary API ──────────────────────────────────────────────────────
export {
  CodexProvider,
  createCodexReactPreset,
  type CodexProviderProps,
  type CodexProviderApi,
  type CodexRuntimeOwnedConversationApi,
} from "./CodexProvider.js";
export {
  useCodex,
  type UseCodexOptions,
  type UseCodexResult,
  type UseCodexThreadsConfig,
} from "./useCodex.js";

// ── Standalone hooks ─────────────────────────────────────────────────
export {
  useCodexRuntimeBridge,
  type CodexRuntimeBridgeControls,
  type CodexRuntimeBridgeState,
} from "./useCodexRuntimeBridge.js";
export {
  useCodexAccountAuth,
  type CodexAccountAuthControls,
} from "./useCodexAccountAuth.js";
export {
  useCodexThreadState,
} from "./useCodexThreadState.js";
// useCodexThreads is composed through useCodex({ threads }) — not exported
// as a standalone hook. Type exports remain available below.

// ── Utilities ────────────────────────────────────────────────────────
export {
  optimisticallySendCodexMessage,
} from "./optimisticallySendCodexMessage.js";

// ── Derive functions ─────────────────────────────────────────────────
export {
  deriveCodexThreadActivity,
} from "./threadActivity.js";
export {
  deriveCodexIngestHealth,
} from "./ingestHealth.js";
export {
  deriveCodexBranchActivity,
} from "./branchActivity.js";
export {
  deriveCodexDynamicToolCalls,
  parseCodexDynamicToolPayload,
} from "./dynamicTools.js";
export {
  deriveCodexTokenUsage,
} from "./tokenUsage.js";

// ── Types ────────────────────────────────────────────────────────────
export type {
  CodexMessagesQuery,
  CodexMessagesQueryArgs,
  CodexReasoningQuery,
  CodexReasoningQueryArgs,
  CodexStreamArgs,
  CodexStreamsResult,
} from "./types.js";
export type {
  CodexThreadStateQuery,
} from "./useCodexThreadState.js";
export type {
  CodexThreadActivityQuery,
} from "./useCodexThreadActivity.js";
export type {
  CodexIngestHealthQuery,
} from "./useCodexIngestHealth.js";
export type {
  CodexBranchActivityQuery,
} from "./useCodexBranchActivity.js";
export type {
  CodexTokenUsageQuery,
} from "./useCodexTokenUsage.js";
export type {
  CodexChatConfig,
  CodexChatDynamicToolsConfig,
  CodexChatOptions,
  CodexChatResult,
  CodexChatTools,
} from "./useCodexChat.js";
export type {
  CodexDynamicToolsQuery,
  CodexDynamicToolsRespond,
  CodexDynamicToolHandler,
  CodexDynamicToolsHandlerMap,
} from "./useCodexDynamicTools.js";
export type {
  CodexThreadsControls,
  CodexThreadsListQuery,
} from "./useCodexThreads.js";
export type {
  CodexTurnMessagesQuery,
  CodexTurnStateQuery,
} from "./useCodexTurn.js";
export type {
  CodexThreadActivity,
  CodexThreadActivityPhase,
  CodexThreadActivityThreadState,
  CodexThreadActivityMessageLike,
  CodexThreadActivityDispatchLike,
  CodexThreadActivityStreamStatLike,
  CodexThreadActivityTurnLike,
} from "./threadActivity.js";
export type {
  CodexIngestHealth,
  CodexIngestHealthIssue,
  CodexIngestHealthStatus,
  CodexIngestHealthThreadState,
} from "./ingestHealth.js";
export type {
  CodexBranchActivityOptions,
  CodexBranchActivityThreadState,
  CodexThreadActivityPendingApprovalLike,
} from "./branchActivity.js";
export type {
  CodexDynamicToolServerRequest,
  CodexDynamicToolCall,
  CodexDynamicToolResponse,
} from "./dynamicTools.js";
export type {
  CodexTokenUsage,
  CodexTokenUsageBreakdown,
  CodexTurnTokenUsage,
} from "./tokenUsage.js";
