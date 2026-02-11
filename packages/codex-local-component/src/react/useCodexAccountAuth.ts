"use client";

import { useCallback, useMemo, useState } from "react";

export type CodexAccountAuthControls<LoginParams = unknown> = {
  readAccount: (args?: { refreshToken?: boolean }) => Promise<unknown>;
  loginAccount: (args: { params: LoginParams }) => Promise<unknown>;
  cancelAccountLogin: (args: { loginId: string }) => Promise<unknown>;
  logoutAccount: () => Promise<unknown>;
  readAccountRateLimits: () => Promise<unknown>;
  respondChatgptAuthTokensRefresh?: (args: {
    requestId: string | number;
    idToken: string;
    accessToken: string;
  }) => Promise<unknown>;
};

type AuthAction =
  | "read"
  | "read_refresh"
  | "login"
  | "cancel_login"
  | "logout"
  | "read_rate_limits"
  | "refresh_tokens";

export function useCodexAccountAuth<LoginParams = unknown>(
  controls: CodexAccountAuthControls<LoginParams>,
) {
  const [busyAction, setBusyAction] = useState<AuthAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);

  const run = useCallback(async <T,>(action: AuthAction, fn: () => Promise<T>): Promise<T> => {
    setBusyAction(action);
    setError(null);
    try {
      const result = await fn();
      setLastResult(result);
      return result;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      throw nextError;
    } finally {
      setBusyAction((current) => (current === action ? null : current));
    }
  }, []);

  const readAccount = useCallback(
    (args?: { refreshToken?: boolean }) =>
      run(args?.refreshToken ? "read_refresh" : "read", () => controls.readAccount(args)),
    [controls, run],
  );
  const loginAccount = useCallback(
    (args: { params: LoginParams }) => run("login", () => controls.loginAccount(args)),
    [controls, run],
  );
  const cancelAccountLogin = useCallback(
    (args: { loginId: string }) => run("cancel_login", () => controls.cancelAccountLogin(args)),
    [controls, run],
  );
  const logoutAccount = useCallback(() => run("logout", controls.logoutAccount), [controls, run]);
  const readAccountRateLimits = useCallback(
    () => run("read_rate_limits", controls.readAccountRateLimits),
    [controls, run],
  );
  const respondChatgptAuthTokensRefresh = useCallback(
    (args: { requestId: string | number; idToken: string; accessToken: string }) => {
      const respond = controls.respondChatgptAuthTokensRefresh;
      if (!respond) {
        throw new Error("respondChatgptAuthTokensRefresh is not configured.");
      }
      return run("refresh_tokens", () => respond(args));
    },
    [controls, run],
  );

  return useMemo(
    () => ({
      busyAction,
      isBusy: busyAction !== null,
      error,
      lastResult,
      readAccount,
      loginAccount,
      cancelAccountLogin,
      logoutAccount,
      readAccountRateLimits,
      respondChatgptAuthTokensRefresh,
    }),
    [
      busyAction,
      cancelAccountLogin,
      error,
      lastResult,
      loginAccount,
      logoutAccount,
      readAccount,
      readAccountRateLimits,
      respondChatgptAuthTokensRefresh,
    ],
  );
}
