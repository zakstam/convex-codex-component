"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CodexRuntimeBridgeState = {
  running: boolean;
  conversationId?: string | null;
  turnId?: string | null;
  lastError?: string | null;
  [key: string]: unknown;
};

export type CodexRuntimeBridgeControls<
  StartArgs,
  SendArgs = string,
  StartResult = unknown,
  StopResult = unknown,
  SendTurnResult = unknown,
  InterruptResult = unknown,
> = {
  start: (args: StartArgs) => Promise<StartResult>;
  stop: () => Promise<StopResult>;
  getState?: () => Promise<CodexRuntimeBridgeState>;
  sendTurn?: (args: SendArgs) => Promise<SendTurnResult>;
  interrupt?: () => Promise<InterruptResult>;
};

export function useCodexRuntimeBridge<
  StartArgs,
  SendArgs = string,
  StartResult = unknown,
  StopResult = unknown,
  SendTurnResult = unknown,
  InterruptResult = unknown,
>(
  controls: CodexRuntimeBridgeControls<
    StartArgs,
    SendArgs,
    StartResult,
    StopResult,
    SendTurnResult,
    InterruptResult
  >,
  options?: {
    initialState?: CodexRuntimeBridgeState;
  },
) {
  const [state, setState] = useState<CodexRuntimeBridgeState>(
    options?.initialState ?? { running: false, conversationId: null, turnId: null, lastError: null },
  );
  const stateRef = useRef(state);
  const [busyAction, setBusyAction] = useState<null | "start" | "stop" | "refresh" | "send" | "interrupt">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const runAction = useCallback(async <T,>(action: typeof busyAction, fn: () => Promise<T>): Promise<T> => {
    setBusyAction(action);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      throw nextError;
    } finally {
      setBusyAction((current) => (current === action ? null : current));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!controls.getState) {
      return stateRef.current;
    }
    const next = await runAction("refresh", controls.getState);
    setState(next);
    return next;
  }, [controls.getState, runAction]);

  const start = useCallback(
    async (args: StartArgs) => {
      const result = await runAction("start", () => controls.start(args));
      if (controls.getState) {
        const next = await controls.getState();
        setState(next);
      } else {
        setState((current) => ({ ...current, running: true }));
      }
      return result;
    },
    [controls, runAction],
  );

  const stop = useCallback(async () => {
    const result = await runAction("stop", controls.stop);
    if (controls.getState) {
      const next = await controls.getState();
      setState(next);
    } else {
      setState((current) => ({ ...current, running: false }));
    }
    return result;
  }, [controls, runAction]);

  const sendTurn = useCallback(
    async (args: SendArgs) => {
      const sendTurnControl = controls.sendTurn;
      if (!sendTurnControl) {
        return undefined;
      }
      return runAction("send", () => sendTurnControl(args));
    },
    [controls.sendTurn, runAction],
  );

  const interrupt = useCallback(async () => {
    if (!controls.interrupt) {
      return undefined;
    }
    return runAction("interrupt", controls.interrupt);
  }, [controls.interrupt, runAction]);

  return useMemo(
    () => ({
      state,
      error,
      busyAction,
      isBusy: busyAction !== null,
      start,
      stop,
      refresh,
      sendTurn,
      interrupt,
    }),
    [busyAction, error, interrupt, refresh, sendTurn, start, state, stop],
  );
}
