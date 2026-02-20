"use client";

import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toOptionalRestArgsOrSkip } from "./queryArgs.js";

export type CodexThreadsListQuery<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Result = unknown,
> = FunctionReference<"query", "public", Args, Result>;

export type CodexThreadsControls<
  CreateResult = unknown,
  ResolveResult = unknown,
  ResumeResult = unknown,
> = {
  createThread?: (args?: Record<string, unknown>) => Promise<CreateResult>;
  resolveThread?: (args: { localThreadId: string }) => Promise<ResolveResult>;
  resumeThread?: (args: { threadHandle: string }) => Promise<ResumeResult>;
};

export function useCodexThreads<
  Query extends CodexThreadsListQuery<Record<string, unknown>, unknown>,
  CreateResult = unknown,
  ResolveResult = unknown,
  ResumeResult = unknown,
>(
  config: {
    list: {
      query: Query;
      args: FunctionArgs<Query> | "skip";
    };
    controls?: CodexThreadsControls<CreateResult, ResolveResult, ResumeResult>;
    initialSelectedThreadHandle?: string | null;
  },
) {
  const listArgs = toOptionalRestArgsOrSkip<Query>(config.list.args);
  const listed = useQuery(config.list.query, ...listArgs);

  const [selectedThreadHandle, setSelectedThreadHandle] = useState<string | null>(
    config.initialSelectedThreadHandle ?? null,
  );
  const [busyAction, setBusyAction] = useState<null | "create" | "resolve" | "resume">(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(action: typeof busyAction, fn: () => Promise<T>) => {
    setBusyAction(action);
    setError(null);
    try {
      return await fn();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      throw nextError;
    } finally {
      setBusyAction((current) => (current === action ? null : current));
    }
  }, []);

  // ── Stale selection guard ────────────────────────────────────────────
  // When the selected thread is deleted, the list query updates reactively
  // but selectedThreadHandle state is stale. Convex's useQuery throws server
  // errors during render, so we must validate BEFORE the return value
  // reaches useCodex (which would subscribe to listThreadMessages).
  const validatedSelectedThreadHandle = useMemo(() => {
    if (!selectedThreadHandle || listed === undefined) return selectedThreadHandle;

    // Extract thread items — supports { threads: [...] } (standard shape)
    // and direct array shapes.
    const items: unknown[] | undefined = Array.isArray(listed)
      ? listed
      : listed && typeof listed === "object" && "threads" in listed
        ? ((listed as Record<string, unknown>).threads as unknown[] | undefined)
        : undefined;

    if (!items) return selectedThreadHandle;

    const hasMatchingThreadId = (value: unknown, expected: string): boolean => {
      if (typeof value !== "object" || value === null || !("threadId" in value)) {
        return false;
      }
      return Reflect.get(value, "threadId") === expected;
    };

    const found = items.some((item) => hasMatchingThreadId(item, selectedThreadHandle));

    return found ? selectedThreadHandle : null;
  }, [selectedThreadHandle, listed]);

  // Clean up stale state after the render-time guard prevents the crash
  useEffect(() => {
    if (selectedThreadHandle && validatedSelectedThreadHandle === null) {
      setSelectedThreadHandle(null);
    }
  }, [selectedThreadHandle, validatedSelectedThreadHandle]);

  const create = useCallback(
    async (args?: Record<string, unknown>) => {
      const createThread = config.controls?.createThread;
      if (!createThread) {
        return null;
      }
      return run("create", () => createThread(args));
    },
    [config.controls, run],
  );

  const resolve = useCallback(
    async (localThreadId: string) => {
      const resolveThread = config.controls?.resolveThread;
      if (!resolveThread) {
        return null;
      }
      const result = await run("resolve", () => resolveThread({ localThreadId }));
      setSelectedThreadHandle(localThreadId);
      return result;
    },
    [config.controls, run],
  );

  const resume = useCallback(
    async (threadHandle: string) => {
      const resumeThread = config.controls?.resumeThread;
      if (!resumeThread) {
        return null;
      }
      const result = await run("resume", () => resumeThread({ threadHandle }));
      setSelectedThreadHandle(threadHandle);
      return result;
    },
    [config.controls, run],
  );

  return useMemo(
    () => ({
      threads: listed,
      selectedThreadHandle: validatedSelectedThreadHandle,
      setSelectedThreadHandle,
      busyAction,
      isBusy: busyAction !== null,
      error,
      create,
      resolve,
      resume,
    }),
    [busyAction, create, error, listed, resolve, resume, validatedSelectedThreadHandle],
  );
}
