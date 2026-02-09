"use client";

import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useCallback, useMemo, useState } from "react";

export type CodexStartTurnMutation<Args = Record<string, unknown>> = FunctionReference<
  "mutation",
  "public",
  {
    threadId: string;
    turnId: string;
    idempotencyKey: string;
    input: Array<{
      type: string;
      text?: string;
      url?: string;
      path?: string;
    }>;
  } & Args,
  unknown
>;

export type CodexComposerSendArgs<
  Mutation extends CodexStartTurnMutation<unknown>,
> = Mutation extends CodexStartTurnMutation<unknown>
  ? Omit<FunctionArgs<Mutation>, "input">
  : never;

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function useCodexComposer<Mutation extends CodexStartTurnMutation<any>>(
  mutation: Mutation,
  options?: {
    createTurnId?: () => string;
    createIdempotencyKey?: () => string;
    initialValue?: string;
  },
) {
  const runStartTurn = useMutation(mutation);
  const [value, setValue] = useState(options?.initialValue ?? "");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (args: FunctionArgs<Mutation>) => {
      setIsSending(true);
      setError(null);
      try {
        return await runStartTurn(args);
      } catch (err) {
        const next = err instanceof Error ? err.message : String(err);
        setError(next);
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [runStartTurn],
  );

  const sendText = useCallback(
    async (args: CodexComposerSendArgs<Mutation> & { text?: string }) => {
      const text = args.text ?? value;
      if (!text.trim()) {
        return null;
      }
      const payload = {
        ...args,
        turnId: (args as { turnId?: string }).turnId ?? options?.createTurnId?.() ?? randomId(),
        idempotencyKey:
          (args as { idempotencyKey?: string }).idempotencyKey ??
          options?.createIdempotencyKey?.() ??
          randomId(),
        input: [{ type: "text", text }],
      } as FunctionArgs<Mutation>;
      const result = await send(payload);
      setValue("");
      return result;
    },
    [options?.createIdempotencyKey, options?.createTurnId, send, value],
  );

  const reset = useCallback(() => {
    setValue(options?.initialValue ?? "");
    setError(null);
  }, [options?.initialValue]);

  return useMemo(
    () => ({
      value,
      setValue,
      isSending,
      error,
      send,
      sendText,
      reset,
    }),
    [value, isSending, error, send, sendText, reset],
  );
}
