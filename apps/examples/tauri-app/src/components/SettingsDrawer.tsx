import type { BridgeState } from "../lib/tauriBridge";
import type {
  CodexIngestHealth,
  CodexThreadActivity,
  CodexThreadActivityThreadState,
  CodexTokenUsage,
} from "@zakstam/codex-local-component/react";
import type { PendingAuthRefreshRequest } from "../hooks/useCodexTauriEvents";

import { SettingsSection } from "./SettingsSection";
import { ConnectionPanel } from "./ConnectionPanel";
import { ToolDisablePanel } from "./ToolDisablePanel";
import { TokenUsagePanel } from "./TokenUsagePanel";
import { EventLog } from "./EventLog";

type Props = {
  // Connection
  bridge: BridgeState;
  onStart: () => void;
  onStop: () => void;
  onInterrupt: () => void;

  // Auth
  authSummary: string;
  pendingAuthRefresh: PendingAuthRefreshRequest[];
  apiKey: string;
  setApiKey: (v: string) => void;
  chatgptAccountId: string;
  setChatgptAccountId: (v: string) => void;
  chatgptPlanType: string;
  setChatgptPlanType: (v: string) => void;
  accessToken: string;
  setAccessToken: (v: string) => void;
  cancelLoginId: string;
  setCancelLoginId: (v: string) => void;
  accountAuthIsBusy: boolean;
  onAccountRead: (refresh: boolean) => void;
  onLoginApiKey: () => void;
  onLoginChatgpt: () => void;
  onLoginChatgptTokens: () => void;
  onCancelLogin: () => void;
  onLogout: () => void;
  onReadRateLimits: () => void;
  onRespondAuthRefresh: (requestId: string | number) => void;

  // Tool policy
  availableTools: string[];
  disabledTools: string[];
  onSetDisabledTools: (tools: string[]) => Promise<void>;

  // Token usage
  tokenUsage: CodexTokenUsage | null;

  // Data management
  actorReady: boolean;
  cleanupConversationId: string | null;
  latestThreadTurnId: string | null;
  activeDeletionJobId: string | null;
  activeDeletionLabel: string | null;
  deletionStatus: any;
  scheduledDeleteCountdown: number | null;
  onDeleteCurrentThread: () => Promise<void>;
  onDeleteLatestTurn: () => Promise<void>;
  onPurgeActorData: () => Promise<void>;
  onUndoScheduledDeletion: () => Promise<void>;
  onForceScheduledDeletion: () => Promise<void>;

  // Developer
  runtimeLog: Array<{ id: string; line: string }>;
  threadState: CodexThreadActivityThreadState | null | undefined;
  threadActivity: CodexThreadActivity;
  ingestHealth: CodexIngestHealth;

  // Repro
  reproRecording: boolean;
  reproCommandCount: number;
  reproObservedCount: number;
  lastCapturedInvokeCommand: string | null;
  lastReproArtifactName: string | null;
  startReproRecording: () => void;
  stopReproRecording: () => void;
  exportReproRecording: () => void;

  // Drawer control
  onClose: () => void;
};

export function SettingsDrawer(props: Props) {
  const {
    bridge,
    onStart,
    onStop,
    onInterrupt,

    authSummary,
    pendingAuthRefresh,
    apiKey,
    setApiKey,
    chatgptAccountId,
    setChatgptAccountId,
    chatgptPlanType,
    setChatgptPlanType,
    accessToken,
    setAccessToken,
    cancelLoginId,
    setCancelLoginId,
    accountAuthIsBusy,
    onAccountRead,
    onLoginApiKey,
    onLoginChatgpt,
    onLoginChatgptTokens,
    onCancelLogin,
    onLogout,
    onReadRateLimits,
    onRespondAuthRefresh,

    availableTools,
    disabledTools,
    onSetDisabledTools,

    tokenUsage,

    actorReady,
    cleanupConversationId,
    latestThreadTurnId,
    activeDeletionJobId,
    activeDeletionLabel,
    deletionStatus,
    scheduledDeleteCountdown,
    onDeleteCurrentThread,
    onDeleteLatestTurn,
    onPurgeActorData,
    onUndoScheduledDeletion,
    onForceScheduledDeletion,

    runtimeLog,
    threadState,
    threadActivity,
    ingestHealth,

    reproRecording,
    reproCommandCount,
    reproObservedCount,
    lastCapturedInvokeCommand,
    lastReproArtifactName,
    startReproRecording,
    stopReproRecording,
    exportReproRecording,

    onClose,
  } = props;

  const authControlsDisabled = !bridge.running || accountAuthIsBusy;

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="settings-drawer-header">
        <span className="settings-drawer-title">Settings</span>
        <button
          className="settings-drawer-close"
          onClick={onClose}
          aria-label="Close settings"
        >
          &times;
        </button>
      </div>

      {/* ── Connection (always visible, not collapsible) ────────── */}
      <ConnectionPanel
        bridge={bridge}
        onStart={onStart}
        onStop={onStop}
        onInterrupt={onInterrupt}
      />

      {/* ── Account & Auth ──────────────────────────────────────── */}
      <SettingsSection title="Account & Auth">
        <div className="auth-controls">
          <div className="auth-row">
            <button
              className="secondary"
              onClick={() => onAccountRead(false)}
              disabled={authControlsDisabled}
            >
              Read Account
            </button>
            <button
              className="secondary"
              onClick={() => onAccountRead(true)}
              disabled={authControlsDisabled}
            >
              Read + Refresh
            </button>
            <button
              className="danger"
              onClick={onLogout}
              disabled={authControlsDisabled}
            >
              Logout
            </button>
          </div>

          <label className="auth-label" htmlFor="drawer-api-key-login">
            API Key Login
          </label>
          <div className="auth-row">
            <input
              id="drawer-api-key-login"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              disabled={authControlsDisabled}
            />
            <button onClick={onLoginApiKey} disabled={authControlsDisabled}>
              Login
            </button>
          </div>

          <label className="auth-label" htmlFor="drawer-chatgpt-login">
            ChatGPT Login
          </label>
          <div className="auth-row">
            <button
              id="drawer-chatgpt-login"
              className="secondary"
              onClick={onLoginChatgpt}
              disabled={authControlsDisabled}
            >
              Start OAuth Login
            </button>
          </div>

          <label className="auth-label" htmlFor="drawer-chatgpt-account-id">
            ChatGPT Token Login
          </label>
          <div className="auth-grid">
            <input
              id="drawer-chatgpt-account-id"
              type="text"
              value={chatgptAccountId}
              onChange={(e) => setChatgptAccountId(e.target.value)}
              placeholder="chatgptAccountId"
              disabled={authControlsDisabled}
            />
            <input
              type="text"
              value={chatgptPlanType}
              onChange={(e) => setChatgptPlanType(e.target.value)}
              placeholder="chatgptPlanType (optional)"
              disabled={authControlsDisabled}
            />
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="accessToken"
              disabled={authControlsDisabled}
            />
          </div>
          <div className="auth-row">
            <button onClick={onLoginChatgptTokens} disabled={authControlsDisabled}>
              Login With Tokens
            </button>
          </div>

          <label className="auth-label" htmlFor="drawer-cancel-login-id">
            Cancel Login
          </label>
          <div className="auth-row">
            <input
              id="drawer-cancel-login-id"
              type="text"
              value={cancelLoginId}
              onChange={(e) => setCancelLoginId(e.target.value)}
              placeholder="loginId"
              disabled={authControlsDisabled}
            />
            <button
              className="secondary"
              onClick={onCancelLogin}
              disabled={authControlsDisabled}
            >
              Cancel
            </button>
            <button
              className="secondary"
              onClick={onReadRateLimits}
              disabled={authControlsDisabled}
            >
              Read Rate Limits
            </button>
          </div>

          {pendingAuthRefresh.length > 0 && (
            <div className="auth-refresh-list">
              <h3>Pending Auth Token Refresh</h3>
              {pendingAuthRefresh.map((request) => (
                <div
                  className="auth-refresh-item"
                  key={`${typeof request.requestId}:${String(request.requestId)}`}
                >
                  <p className="code auth-refresh-meta">
                    id={String(request.requestId)} reason={request.reason}
                    {request.previousAccountId
                      ? ` previousAccountId=${request.previousAccountId}`
                      : ""}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => onRespondAuthRefresh(request.requestId)}
                    disabled={authControlsDisabled}
                  >
                    Respond With Tokens
                  </button>
                </div>
              ))}
            </div>
          )}

          <h3>Last Auth Result</h3>
          <pre className="auth-summary code">{authSummary}</pre>
        </div>
      </SettingsSection>

      {/* ── Tool Policy ─────────────────────────────────────────── */}
      <SettingsSection title="Tool Policy">
        <ToolDisablePanel
          availableTools={availableTools}
          disabledTools={disabledTools}
          running={bridge.running}
          onSetDisabledTools={onSetDisabledTools}
        />
      </SettingsSection>

      {/* ── Token Usage ─────────────────────────────────────────── */}
      <SettingsSection title="Token Usage">
        <TokenUsagePanel tokenUsage={tokenUsage} />
      </SettingsSection>

      {/* ── Data Management ─────────────────────────────────────── */}
      <SettingsSection title="Data Management">
        <div className="auth-controls">
          <p className="meta">
            Stop the runtime before deleting data.
            Deletions are scheduled with a 10-minute grace period.
          </p>
          <div className="auth-row">
            <button
              className="danger"
              onClick={() => void onDeleteCurrentThread()}
              disabled={!cleanupConversationId || !actorReady || bridge.running}
            >
              Delete Conversation
            </button>
            <button
              className="danger"
              onClick={() => void onDeleteLatestTurn()}
              disabled={
                !cleanupConversationId ||
                !latestThreadTurnId ||
                !actorReady ||
                bridge.running
              }
            >
              Delete Last Response
            </button>
          </div>
          <div className="auth-row">
            <button
              className="danger"
              onClick={() => void onPurgeActorData()}
              disabled={!actorReady || bridge.running}
            >
              Delete All My Data
            </button>
          </div>
          <div className="auth-row">
            <button
              className="secondary"
              onClick={() => void onUndoScheduledDeletion()}
              disabled={
                !activeDeletionJobId ||
                !actorReady ||
                bridge.running ||
                deletionStatus?.status !== "scheduled"
              }
            >
              Undo
            </button>
            <button
              className="danger"
              onClick={() => void onForceScheduledDeletion()}
              disabled={
                !activeDeletionJobId ||
                !actorReady ||
                bridge.running ||
                deletionStatus?.status !== "scheduled"
              }
            >
              Delete Now
            </button>
          </div>
          {activeDeletionJobId && (
            <p className="meta">
              {activeDeletionLabel ?? "Deletion"} — {deletionStatus?.status ?? "queued"}
              {scheduledDeleteCountdown !== null && (
                <> (starts in {Math.ceil(scheduledDeleteCountdown / 60000)} min)</>
              )}
            </p>
          )}
          {!activeDeletionJobId && (
            <p className="meta">No pending deletions.</p>
          )}
        </div>
      </SettingsSection>

      {/* ── Developer ───────────────────────────────────────────── */}
      <SettingsSection title="Developer" defaultOpen={false}>
        <div className="auth-controls">
          {/* Bridge raw fields */}
          <div className="bridge-fields">
            <div className="bridge-field">
              <span className="bridge-field-label">Status</span>
              <span className={`status-badge ${bridge.lastError ? "error" : bridge.running ? "running" : "stopped"}`}>
                {bridge.lastError ? "Error" : bridge.running ? "Running" : "Stopped"}
              </span>
            </div>
            <div className="bridge-field">
              <span className="bridge-field-label">Turn</span>
              <span className="code">{bridge.turnId ?? "\u2014"}</span>
            </div>
            <div className="bridge-field">
              <span className="bridge-field-label">Conversation ID</span>
              <span className="code">{bridge.conversationId ?? "\u2014"}</span>
            </div>
            <div className="bridge-field">
              <span className="bridge-field-label">Pending</span>
              <span className="code">{bridge.pendingServerRequestCount ?? 0}</span>
            </div>
            <div className="bridge-field">
              <span className="bridge-field-label">Ingest Enqueued</span>
              <span className="code">{bridge.ingestEnqueuedEventCount ?? 0}</span>
            </div>
            <div className="bridge-field">
              <span className="bridge-field-label">Ingest Skipped</span>
              <span className="code">{bridge.ingestSkippedEventCount ?? 0}</span>
            </div>
          </div>

          {/* Repro recorder */}
          <h3>Repro Recorder</h3>
          <p className="meta">
            Capture command/event/state traces, then export a replay artifact
            for debug-harness.
          </p>
          <div className="auth-row">
            <button
              className={reproRecording ? "danger" : "secondary"}
              onClick={reproRecording ? stopReproRecording : startReproRecording}
            >
              {reproRecording ? "Stop recording" : "Record repro"}
            </button>
            <button
              onClick={exportReproRecording}
              disabled={reproCommandCount === 0 && reproObservedCount === 0}
            >
              Export repro artifact
            </button>
          </div>
          <pre className="auth-summary code">
            {`recording: ${reproRecording ? "yes" : "no"}\ncommands: ${reproCommandCount}\nobserved events: ${reproObservedCount}${
              lastCapturedInvokeCommand
                ? `\nlast invoke_start: ${lastCapturedInvokeCommand}`
                : ""
            }${
              lastReproArtifactName
                ? `\nlast export: ${lastReproArtifactName}`
                : ""
            }`}
          </pre>

          {/* Event log */}
          <EventLog
            threadState={threadState}
            threadActivity={threadActivity}
            ingestHealth={ingestHealth}
            runtimeLog={runtimeLog}
          />
        </div>
      </SettingsSection>
    </>
  );
}
