import { useMemo, useState, useCallback, useRef } from "react";
import { useQuery } from "convex/react";
import { CodexProvider } from "@zakstam/codex-runtime-react";
import {
  bridge as tauriBridge,
  type ActorContext,
} from "./lib/tauriBridge";
import { AppShell } from "./components/AppShell";
import { Header } from "./components/Header";
import { ThreadSidebar } from "./components/ThreadSidebar";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { MessageList } from "./components/MessageList";
import { InlineApproval } from "./components/InlineApproval";
import { Composer } from "./components/Composer";
import { ToastContainer } from "./components/Toast";
import { WelcomeModal } from "./components/WelcomeModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { KNOWN_DYNAMIC_TOOLS } from "./lib/dynamicTools";
import {
  useAppController,
  reactApi,
  requireDefined,
  ACTOR_STORAGE_KEY,
  chatApi,
} from "./hooks/useAppController";

function getStoredActorUserId(): string | null {
  if (typeof window === "undefined") return "demo-user";
  return window.localStorage.getItem(ACTOR_STORAGE_KEY)?.trim() || null;
}

export default function App() {
  const [actorUserId, setActorUserId] = useState<string | null>(() => getStoredActorUserId());
  const actorBinding = useQuery(
    requireDefined(chatApi.getActorBindingForBootstrap, "api.chat.getActorBindingForBootstrap"),
  );
  const preferredBoundUserId = actorBinding?.lockEnabled
    ? actorBinding.pinnedUserId?.trim() || actorBinding.boundUserId?.trim() || null
    : actorBinding?.pinnedUserId?.trim() || null;
  const actorReady = actorBinding !== undefined && !!actorUserId && (!preferredBoundUserId || preferredBoundUserId === actorUserId);
  const actor: ActorContext | null = useMemo(
    () => (actorUserId ? { userId: actorUserId } : null),
    [actorUserId],
  );

  if (!actor) {
    return <WelcomeModal onSubmit={setActorUserId} />;
  }

  return (
    <CodexProvider preset={reactApi} actor={actor} syncHydrationSource={tauriBridge.syncHydration}>
      <AppContent
        actor={actor}
        actorReady={actorReady}
        preferredBoundUserId={preferredBoundUserId}
        onActorChange={setActorUserId}
      />
    </CodexProvider>
  );
}

function AppContent({
  actor,
  actorReady,
  preferredBoundUserId,
  onActorChange,
}: {
  actor: ActorContext;
  actorReady: boolean;
  preferredBoundUserId: string | null;
  onActorChange: (userId: string) => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Confirm dialog state ──────────────────────────────────
  const [confirmState, setConfirmState] = useState<{
    message: string;
  } | null>(null);
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

  const requestConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmState({ message });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    confirmResolveRef.current?.(true);
    confirmResolveRef.current = null;
    setConfirmState(null);
  }, []);

  const handleCancelConfirm = useCallback(() => {
    confirmResolveRef.current?.(false);
    confirmResolveRef.current = null;
    setConfirmState(null);
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((prev) => !prev), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const {
    bridge,

    runtimeLog,
    conversation,
    displayMessages,
    latestReasoning,
    selectedConversationId,
    tokenByTurnId,
    pickerThreads,
    showLocalThreads,
    onToggleShowLocalThreads,
    onSelectConversationId,
    onHardDeleteThread,
    pendingServerRequests,
    submittingRequestKey,
    toolDrafts,
    toolOtherDrafts,
    onRespondCommandOrFile,
    onRespondToolUserInput,
    setToolSelected,
    setToolOther,
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
    onDeleteCurrentThread,
    onDeleteLatestTurn,
    onPurgeActorData,
    onUndoScheduledDeletion,
    onForceScheduledDeletion,
    deletionStatus,
    activeDeletionJobId,
    activeDeletionLabel,
    scheduledDeleteCountdown,
    cleanupConversationId,
    latestThreadTurnId,
    reproRecording,
    reproCommandCount,
    reproObservedCount,
    lastCapturedInvokeCommand,
    lastReproArtifactName,
    startReproRecording,
    stopReproRecording,
    exportReproRecording,
    onSetDisabledTools,
    onInsertDynamicToolPrompt,
    toasts,
    dismissToast,
    onStartBridge,
    onStop,
    onInterrupt,
  } = useAppController({ actor, actorReady, preferredBoundUserId, onActorChange, requestConfirm });

  const messages = conversation.messages;
  const threadState = conversation.threadState;
  const threadActivity = conversation.activity;
  const ingestHealth = conversation.ingestHealth;
  const tokenUsage = conversation.tokenUsage;

  const handleSelectConversation = useCallback(
    (id: string) => { void onSelectConversationId(id); },
    [onSelectConversationId],
  );
  const handleDeleteThread = useCallback(
    (id: string) => { void onHardDeleteThread(id); },
    [onHardDeleteThread],
  );
  const handleToggleShowLocalThreads = useCallback(
    (next: boolean) => { void onToggleShowLocalThreads(next); },
    [onToggleShowLocalThreads],
  );

  return (
    <>
      <AppShell
        header={
          <Header
            running={bridge.running}
            hasError={!!bridge.lastError}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            onToggleDrawer={toggleDrawer}
          />
        }
        sidebar={
          <ThreadSidebar
            threads={pickerThreads}
            selected={selectedConversationId}
            onSelect={handleSelectConversation}
            onDelete={handleDeleteThread}
            disabled={!actorReady}
            showLocalThreads={showLocalThreads}
            onToggleShowLocalThreads={handleToggleShowLocalThreads}
          />
        }
        sidebarOpen={sidebarOpen}
        drawer={
          <SettingsDrawer
            bridge={bridge}
            onStart={onStartBridge}
            onStop={onStop}
            onInterrupt={onInterrupt}
            authSummary={authSummary}
            pendingAuthRefresh={pendingAuthRefresh}
            apiKey={apiKey}
            setApiKey={setApiKey}
            chatgptAccountId={chatgptAccountId}
            setChatgptAccountId={setChatgptAccountId}
            chatgptPlanType={chatgptPlanType}
            setChatgptPlanType={setChatgptPlanType}
            accessToken={accessToken}
            setAccessToken={setAccessToken}
            cancelLoginId={cancelLoginId}
            setCancelLoginId={setCancelLoginId}
            accountAuthIsBusy={accountAuthIsBusy}
            onAccountRead={onAccountRead}
            onLoginApiKey={onLoginApiKey}
            onLoginChatgpt={onLoginChatgpt}
            onLoginChatgptTokens={onLoginChatgptTokens}
            onCancelLogin={onCancelLogin}
            onLogout={onLogout}
            onReadRateLimits={onReadRateLimits}
            onRespondAuthRefresh={onRespondAuthRefresh}
            availableTools={[...KNOWN_DYNAMIC_TOOLS]}
            disabledTools={bridge.disabledTools ?? []}
            onSetDisabledTools={onSetDisabledTools}
            tokenUsage={tokenUsage}
            actorReady={actorReady}
            cleanupConversationId={cleanupConversationId}
            latestThreadTurnId={latestThreadTurnId}
            activeDeletionJobId={activeDeletionJobId}
            activeDeletionLabel={activeDeletionLabel}
            deletionStatus={deletionStatus}
            scheduledDeleteCountdown={scheduledDeleteCountdown}
            onDeleteCurrentThread={onDeleteCurrentThread}
            onDeleteLatestTurn={onDeleteLatestTurn}
            onPurgeActorData={onPurgeActorData}
            onUndoScheduledDeletion={onUndoScheduledDeletion}
            onForceScheduledDeletion={onForceScheduledDeletion}
            runtimeLog={runtimeLog}
            threadState={threadState}
            threadActivity={threadActivity}
            ingestHealth={ingestHealth}
            reproRecording={reproRecording}
            reproCommandCount={reproCommandCount}
            reproObservedCount={reproObservedCount}
            lastCapturedInvokeCommand={lastCapturedInvokeCommand}
            lastReproArtifactName={lastReproArtifactName}
            startReproRecording={startReproRecording}
            stopReproRecording={stopReproRecording}
            exportReproRecording={exportReproRecording}
            onClose={closeDrawer}
          />
        }
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
      >
        <MessageList
          messages={displayMessages}
          status={messages.status}
          tokenByTurnId={tokenByTurnId}
        />
        <InlineApproval
          requests={pendingServerRequests}
          submittingKey={submittingRequestKey}
          toolDrafts={toolDrafts}
          toolOtherDrafts={toolOtherDrafts}
          onRespondCommandOrFile={onRespondCommandOrFile}
          onRespondToolUserInput={onRespondToolUserInput}
          setToolSelected={setToolSelected}
          setToolOther={setToolOther}
        />
        {latestReasoning && (
          <div className="reasoning-banner" aria-live="polite" aria-label="Latest reasoning">
            <p className="reasoning-banner-label">Thinking</p>
            <p className="reasoning-banner-text">{latestReasoning.text || "(empty)"}</p>
          </div>
        )}
        <Composer
          value={conversation.composer.value}
          onChange={(value) => conversation.composer.setValue(value)}
          onSubmit={() => void conversation.composer.send()}
          onInsertToolPrompt={onInsertDynamicToolPrompt}
          disabled={!bridge.running || messages.syncProgress.syncState === "syncing"}
          sending={conversation.composer.isSending}
          syncProgressLabel={messages.syncProgress.label}
          syncProgressState={messages.syncProgress.syncState}
        />
      </AppShell>

      <ConfirmDialog
        open={!!confirmState}
        title="Are you sure?"
        description={confirmState?.message ?? ""}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
