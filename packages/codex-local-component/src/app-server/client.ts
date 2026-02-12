import type { ClientInfo } from "../protocol/schemas/ClientInfo.js";
import type { ClientNotification } from "../protocol/schemas/ClientNotification.js";
import type { ClientRequest } from "../protocol/schemas/ClientRequest.js";
import type { ThreadArchiveParams } from "../protocol/schemas/v2/ThreadArchiveParams.js";
import type { CancelLoginAccountParams } from "../protocol/schemas/v2/CancelLoginAccountParams.js";
import type { ChatgptAuthTokensRefreshResponse } from "../protocol/schemas/v2/ChatgptAuthTokensRefreshResponse.js";
import type { ThreadForkParams } from "../protocol/schemas/v2/ThreadForkParams.js";
import type { GetAccountParams } from "../protocol/schemas/v2/GetAccountParams.js";
import type { LoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";
import type { ThreadListParams } from "../protocol/schemas/v2/ThreadListParams.js";
import type { ThreadLoadedListParams } from "../protocol/schemas/v2/ThreadLoadedListParams.js";
import type { ThreadReadParams } from "../protocol/schemas/v2/ThreadReadParams.js";
import type { ThreadResumeParams } from "../protocol/schemas/v2/ThreadResumeParams.js";
import type { ThreadRollbackParams } from "../protocol/schemas/v2/ThreadRollbackParams.js";
import type { ThreadStartParams } from "../protocol/schemas/v2/ThreadStartParams.js";
import type { ThreadUnarchiveParams } from "../protocol/schemas/v2/ThreadUnarchiveParams.js";
import type { CommandExecutionApprovalDecision } from "../protocol/schemas/v2/CommandExecutionApprovalDecision.js";
import type { CommandExecutionRequestApprovalResponse } from "../protocol/schemas/v2/CommandExecutionRequestApprovalResponse.js";
import type { FileChangeApprovalDecision } from "../protocol/schemas/v2/FileChangeApprovalDecision.js";
import type { FileChangeRequestApprovalResponse } from "../protocol/schemas/v2/FileChangeRequestApprovalResponse.js";
import type { DynamicToolCallOutputContentItem } from "../protocol/schemas/v2/DynamicToolCallOutputContentItem.js";
import type { DynamicToolCallResponse } from "../protocol/schemas/v2/DynamicToolCallResponse.js";
import type { DynamicToolSpec } from "../protocol/schemas/v2/DynamicToolSpec.js";
import type { ToolRequestUserInputAnswer } from "../protocol/schemas/v2/ToolRequestUserInputAnswer.js";
import type { ToolRequestUserInputResponse } from "../protocol/schemas/v2/ToolRequestUserInputResponse.js";
import type { TurnInterruptParams } from "../protocol/schemas/v2/TurnInterruptParams.js";
import type { TurnStartParams } from "../protocol/schemas/v2/TurnStartParams.js";
import type { RequestId } from "../protocol/schemas/RequestId.js";
import type { ClientServerRequestResponse } from "../protocol/outbound.js";

type RequestMethod = ClientRequest["method"];

type RequestFor<M extends RequestMethod> = Extract<ClientRequest, { method: M }>;

type RequestParams<M extends RequestMethod> = RequestFor<M>["params"];

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLikeThreadId(threadId: string): boolean {
  return UUID_LIKE.test(threadId);
}

function assertUuidThreadId(threadId: string): void {
  if (!isUuidLikeThreadId(threadId)) {
    throw new Error(
      "Invalid threadId for app-server request. Expected UUID format. Resolve thread IDs through threads.resolve before turn/start.",
    );
  }
}

export function buildClientRequest<M extends RequestMethod>(
  method: M,
  id: number,
  params: RequestParams<M>,
): RequestFor<M> {
  return { method, id, params } as RequestFor<M>;
}

export function buildInitializeRequest(id: number, clientInfo: ClientInfo): RequestFor<"initialize"> {
  return buildInitializeRequestWithCapabilities(id, clientInfo, { experimentalApi: false });
}

export function buildInitializeRequestWithCapabilities(
  id: number,
  clientInfo: ClientInfo,
  capabilities: { experimentalApi: boolean },
): RequestFor<"initialize"> {
  return buildClientRequest("initialize", id, {
    clientInfo,
    capabilities,
  });
}

export function buildInitializedNotification(): ClientNotification {
  return { method: "initialized" };
}

export function buildThreadStartRequest(
  id: number,
  params?: Omit<ThreadStartParams, "experimentalRawEvents"> & { dynamicTools?: DynamicToolSpec[] },
): RequestFor<"thread/start"> {
  const requestParams: RequestParams<"thread/start"> = {
    ...params,
    experimentalRawEvents: false,
  };
  return buildClientRequest(
    "thread/start",
    id,
    requestParams,
  );
}

export function buildThreadResumeRequest(
  id: number,
  params: ThreadResumeParams & { dynamicTools?: DynamicToolSpec[] },
): RequestFor<"thread/resume"> {
  assertUuidThreadId(params.threadId);
  const requestParams: RequestParams<"thread/resume"> = params;
  return buildClientRequest("thread/resume", id, requestParams);
}

export function buildThreadForkRequest(
  id: number,
  params: ThreadForkParams,
): RequestFor<"thread/fork"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("thread/fork", id, params);
}

export function buildThreadReadRequest(
  id: number,
  params: Omit<ThreadReadParams, "includeTurns"> & { includeTurns?: boolean },
): RequestFor<"thread/read"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("thread/read", id, {
    threadId: params.threadId,
    includeTurns: params.includeTurns ?? false,
  });
}

export function buildThreadListRequest(
  id: number,
  params: ThreadListParams = {},
): RequestFor<"thread/list"> {
  return buildClientRequest("thread/list", id, params);
}

export function buildThreadLoadedListRequest(
  id: number,
  params: ThreadLoadedListParams = {},
): RequestFor<"thread/loaded/list"> {
  return buildClientRequest("thread/loaded/list", id, params);
}

export function buildThreadArchiveRequest(
  id: number,
  params: ThreadArchiveParams,
): RequestFor<"thread/archive"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("thread/archive", id, params);
}

export function buildThreadUnarchiveRequest(
  id: number,
  params: ThreadUnarchiveParams,
): RequestFor<"thread/unarchive"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("thread/unarchive", id, params);
}

export function buildThreadRollbackRequest(
  id: number,
  params: ThreadRollbackParams,
): RequestFor<"thread/rollback"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("thread/rollback", id, params);
}

export function buildTurnStartRequest(
  id: number,
  params: TurnStartParams,
): RequestFor<"turn/start"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("turn/start", id, params);
}

// TODO(turn/steer): Add `buildTurnSteerRequest` once host/runtime adopts mid-turn steering.

export function buildTurnStartTextRequest(
  id: number,
  args: { threadId: string; text: string },
): RequestFor<"turn/start"> {
  return buildTurnStartRequest(id, {
    threadId: args.threadId,
    input: [{ type: "text", text: args.text, text_elements: [] }],
  });
}

export function buildTurnInterruptRequest(
  id: number,
  params: TurnInterruptParams,
): RequestFor<"turn/interrupt"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("turn/interrupt", id, params);
}

export function buildAccountReadRequest(
  id: number,
  params?: { refreshToken?: boolean },
): RequestFor<"account/read"> {
  const requestParams: GetAccountParams = {
    refreshToken: params?.refreshToken ?? false,
  };
  return buildClientRequest("account/read", id, requestParams);
}

export function buildAccountLoginStartRequest(
  id: number,
  params: LoginAccountParams,
): RequestFor<"account/login/start"> {
  return buildClientRequest("account/login/start", id, params);
}

export function buildAccountLoginCancelRequest(
  id: number,
  params: CancelLoginAccountParams,
): RequestFor<"account/login/cancel"> {
  return buildClientRequest("account/login/cancel", id, params);
}

export function buildAccountLogoutRequest(id: number): RequestFor<"account/logout"> {
  return buildClientRequest("account/logout", id, undefined);
}

export function buildAccountRateLimitsReadRequest(id: number): RequestFor<"account/rateLimits/read"> {
  return buildClientRequest("account/rateLimits/read", id, undefined);
}

export function buildCommandExecutionApprovalResponse(
  id: RequestId,
  decision: CommandExecutionApprovalDecision,
): ClientServerRequestResponse {
  const result: CommandExecutionRequestApprovalResponse = { decision };
  return { id, result };
}

export function buildFileChangeApprovalResponse(
  id: RequestId,
  decision: FileChangeApprovalDecision,
): ClientServerRequestResponse {
  const result: FileChangeRequestApprovalResponse = { decision };
  return { id, result };
}

export function buildToolRequestUserInputResponse(
  id: RequestId,
  answers: Record<string, ToolRequestUserInputAnswer>,
): ClientServerRequestResponse {
  const result: ToolRequestUserInputResponse = { answers };
  return { id, result };
}

export function buildDynamicToolCallResponse(
  id: RequestId,
  args: { success: boolean; contentItems: DynamicToolCallOutputContentItem[] },
): ClientServerRequestResponse {
  const result: DynamicToolCallResponse = {
    success: args.success,
    contentItems: args.contentItems,
  };
  return { id, result };
}

export function buildChatgptAuthTokensRefreshResponse(
  id: RequestId,
  tokens: ChatgptAuthTokensRefreshResponse,
): ClientServerRequestResponse {
  return { id, result: tokens };
}
