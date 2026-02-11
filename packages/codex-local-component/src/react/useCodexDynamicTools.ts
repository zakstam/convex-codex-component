"use client";

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DynamicToolCallOutputContentItem } from "../protocol/schemas/v2/DynamicToolCallOutputContentItem.js";
import {
  deriveCodexDynamicToolCalls,
  type CodexDynamicToolCall,
  type CodexDynamicToolResponse,
  type CodexDynamicToolServerRequest,
} from "./dynamicTools.js";

export type CodexDynamicToolsQuery<Args extends Record<string, unknown> = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  Args,
  CodexDynamicToolServerRequest[]
>;

export type CodexDynamicToolsRespond = (args: {
  requestId: string | number;
  success: boolean;
  contentItems: DynamicToolCallOutputContentItem[];
}) => Promise<unknown>;

export type CodexDynamicToolHandler = (
  call: CodexDynamicToolCall,
) => Promise<CodexDynamicToolResponse>;

export type CodexDynamicToolsHandlerMap = Record<string, CodexDynamicToolHandler>;

function requestKey(requestId: string | number): string {
  return `${typeof requestId}:${String(requestId)}`;
}

export function useCodexDynamicTools<
  Query extends CodexDynamicToolsQuery<Record<string, unknown>>,
>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  options: {
    respond?: CodexDynamicToolsRespond;
    handlers?: CodexDynamicToolsHandlerMap;
    autoHandle?: boolean;
    enabled?: boolean;
  },
) {
  const queryArgs = (args === "skip" ? ["skip"] : [args]) as unknown as OptionalRestArgsOrSkip<Query>;
  const requests = useQuery(query, ...queryArgs);
  const calls = useMemo(() => deriveCodexDynamicToolCalls(requests ?? []), [requests]);

  const [runningRequestIds, setRunningRequestIds] = useState<string[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const handledRequestIdsRef = useRef<Set<string>>(new Set());

  const respond = useCallback(
    async (
      call: CodexDynamicToolCall,
      result: CodexDynamicToolResponse,
    ) => {
      if (!options.respond) {
        throw new Error("Dynamic tool response handler is not configured.");
      }
      await options.respond({
        requestId: call.requestId,
        success: result.success,
        contentItems: result.contentItems,
      });
      handledRequestIdsRef.current.add(requestKey(call.requestId));
    },
    [options],
  );

  const runCall = useCallback(
    async (call: CodexDynamicToolCall) => {
      const handler = options.handlers?.[call.toolName];
      if (!handler) {
        return false;
      }
      const key = requestKey(call.requestId);
      if (handledRequestIdsRef.current.has(key)) {
        return true;
      }
      setRunningRequestIds((current) => (current.includes(key) ? current : [...current, key]));
      setLastError(null);
      try {
        const result = await handler(call);
        await respond(call, result);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLastError(message);
        throw error;
      } finally {
        setRunningRequestIds((current) => current.filter((id) => id !== key));
      }
    },
    [options.handlers, respond],
  );

  useEffect(() => {
    if ((options.enabled ?? true) !== true) {
      return;
    }
    if ((options.autoHandle ?? true) !== true) {
      return;
    }
    if (!options.respond) {
      return;
    }
    if (!options.handlers || Object.keys(options.handlers).length === 0) {
      return;
    }
    void (async () => {
      for (const call of calls) {
        const key = requestKey(call.requestId);
        if (handledRequestIdsRef.current.has(key) || runningRequestIds.includes(key)) {
          continue;
        }
        const handler = options.handlers?.[call.toolName];
        if (!handler) {
          continue;
        }
        await runCall(call);
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
    });
  }, [calls, options.autoHandle, options.enabled, options.handlers, runCall, runningRequestIds]);

  return useMemo(
    () => ({
      requests: requests ?? [],
      calls,
      pendingCount: calls.length,
      runningRequestIds,
      lastError,
      runCall,
      respond,
    }),
    [calls, lastError, requests, respond, runCall, runningRequestIds],
  );
}
