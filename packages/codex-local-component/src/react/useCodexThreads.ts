"use client";

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useCallback, useMemo, useState } from "react";

export type CodexThreadsListQuery<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Result = unknown,
> = FunctionReference<"query", "public", Args, Result>;

export type CodexThreadsControls = {
  createThread?: (args?: Record<string, unknown>) => Promise<unknown>;
  resolveThread?: (args: { localThreadId: string }) => Promise<unknown>;
  resumeThread?: (args: { threadId: string }) => Promise<unknown>;
};

export function useCodexThreads<Query extends CodexThreadsListQuery<Record<string, unknown>, unknown>>(
  config: {
    list: {
      query: Query;
      args: FunctionArgs<Query> | "skip";
    };
    controls?: CodexThreadsControls;
    initialSelectedThreadId?: string | null;
  },
) {
  const listQueryArgs = config.list.args === "skip"
    ? ["skip"]
    : [config.list.args] as [FunctionArgs<Query>];
  const listArgs = listQueryArgs as unknown as OptionalRestArgsOrSkip<Query>;
  const listed = useQuery(config.list.query, ...listArgs);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    config.initialSelectedThreadId ?? null,
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
      setSelectedThreadId(localThreadId);
      return result;
    },
    [config.controls, run],
  );

  const resume = useCallback(
    async (threadId: string) => {
      const resumeThread = config.controls?.resumeThread;
      if (!resumeThread) {
        return null;
      }
      const result = await run("resume", () => resumeThread({ threadId }));
      setSelectedThreadId(threadId);
      return result;
    },
    [config.controls, run],
  );

  return useMemo(
    () => ({
      threads: listed,
      selectedThreadId,
      setSelectedThreadId,
      busyAction,
      isBusy: busyAction !== null,
      error,
      create,
      resolve,
      resume,
    }),
    [busyAction, create, error, listed, resolve, resume, selectedThreadId],
  );
}
