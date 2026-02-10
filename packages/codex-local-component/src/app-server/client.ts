import type { ClientInfo } from "../protocol/schemas/ClientInfo.js";
import type { ClientNotification } from "../protocol/schemas/ClientNotification.js";
import type { ClientRequest } from "../protocol/schemas/ClientRequest.js";
import type { ThreadStartParams } from "../protocol/schemas/v2/ThreadStartParams.js";
import type { TurnInterruptParams } from "../protocol/schemas/v2/TurnInterruptParams.js";
import type { TurnStartParams } from "../protocol/schemas/v2/TurnStartParams.js";

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
  return buildClientRequest("initialize", id, {
    clientInfo,
    capabilities: {
      experimentalApi: false,
    },
  });
}

export function buildInitializedNotification(): ClientNotification {
  return { method: "initialized" };
}

export function buildThreadStartRequest(
  id: number,
  params?: Omit<ThreadStartParams, "experimentalRawEvents">,
): RequestFor<"thread/start"> {
  return buildClientRequest("thread/start", id, {
    ...params,
    experimentalRawEvents: false,
  });
}

export function buildTurnStartRequest(
  id: number,
  params: TurnStartParams,
): RequestFor<"turn/start"> {
  assertUuidThreadId(params.threadId);
  return buildClientRequest("turn/start", id, params);
}

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
