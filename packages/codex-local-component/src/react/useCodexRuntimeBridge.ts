"use client";

import { useCallback, useMemo, useState } from "react";

export type CodexRuntimeBridgeState = {
  running: boolean;
  threadId?: string | null;
  turnId?: string | null;
  lastError?: string | null;
  [key: string]: unknown;
};

export type CodexRuntimeBridgeControls<StartArgs, SendArgs = string> = {
  start: (args: StartArgs) => Promise<unknown>;
  stop: () => Promise<unknown>;
  getState?: () => Promise<CodexRuntimeBridgeState>;
  sendTurn?: (args: SendArgs) => Promise<unknown>;
  interrupt?: () => Promise<unknown>;
};

export function useCodexRuntimeBridge<StartArgs, SendArgs = string>(
  controls: CodexRuntimeBridgeControls<StartArgs, SendArgs>,
  options?: {
    initialState?: CodexRuntimeBridgeState;
  },
) {
  const [state, setState] = useState<CodexRuntimeBridgeState>(
    options?.initialState ?? { running: false, threadId: null, turnId: null, lastError: null },
  );
  const [busyAction, setBusyAction] = useState<null | "start" | "stop" | "refresh" | "send" | "interrupt">(null);
  const [error, setError] = useState<string | null>(null);

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
      return state;
    }
    const next = await runAction("refresh", controls.getState);
    setState(next);
    return next;
  }, [controls.getState, runAction, state]);

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
        return;
      }
      return runAction("send", () => sendTurnControl(args));
    },
    [controls.sendTurn, runAction],
  );

  const interrupt = useCallback(async () => {
    if (!controls.interrupt) {
      return;
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
