import { useState, useCallback, useEffect, useRef } from "react";
import { subscribeTauriInvokeCapture } from "../lib/tauriBridge";
import {
  classifyReproErrorClasses,
  type TauriReproArtifactV1,
  type TauriReproCaptureCommand,
  type TauriReproObservedEvent,
} from "../lib/reproArtifact";
import type { ToastItem } from "../components/Toast";

// ── Props ───────────────────────────────────────────────────────────────────

export type UseReproRecordingProps = {
  addToast: (type: ToastItem["type"], message: string) => void;
};

// ── Return type ─────────────────────────────────────────────────────────────

export type UseReproRecordingReturn = {
  reproRecording: boolean;
  reproCommandCount: number;
  reproObservedCount: number;
  lastCapturedInvokeCommand: string | null;
  lastReproArtifactName: string | null;
  startReproRecording: () => void;
  stopReproRecording: () => void;
  exportReproRecording: () => void;
  /** Pass this as `onObservedEvent` to useCodexTauriEvents. */
  onObservedEvent: (event: { tsMs: number; kind: TauriReproObservedEvent["kind"]; payload: unknown }) => void;
};

// ── Hook implementation ─────────────────────────────────────────────────────

export function useReproRecording({ addToast }: UseReproRecordingProps): UseReproRecordingReturn {
  const [reproRecording, setReproRecording] = useState(false);
  const [lastReproArtifactName, setLastReproArtifactName] = useState<string | null>(null);
  const [lastCapturedInvokeCommand, setLastCapturedInvokeCommand] = useState<string | null>(null);
  const reproStartedAtRef = useRef<number | null>(null);
  const reproCommandsRef = useRef<TauriReproCaptureCommand[]>([]);
  const reproObservedRef = useRef<TauriReproObservedEvent[]>([]);

  // ── Repro recording callbacks ──────────────────────────────────────────────

  const startReproRecording = useCallback(() => {
    reproCommandsRef.current = [];
    reproObservedRef.current = [];
    reproStartedAtRef.current = Date.now();
    setLastCapturedInvokeCommand(null);
    setLastReproArtifactName(null);
    setReproRecording(true);
    addToast("info", "Repro recording started.");
  }, [addToast]);

  const stopReproRecording = useCallback(() => {
    setReproRecording(false);
    addToast("info", "Repro recording stopped.");
  }, [addToast]);

  const exportReproRecording = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const startedAtMs = reproStartedAtRef.current ?? Date.now();
    const commands = [...reproCommandsRef.current];
    const observed = [...reproObservedRef.current];
    if (commands.length === 0 && observed.length === 0) {
      addToast("error", "No repro events captured yet.");
      return;
    }
    const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
    const convexUrlHost = convexUrl
      ? (() => {
          try {
            return new URL(convexUrl).host;
          } catch {
            return undefined;
          }
        })()
      : undefined;
    const artifact: TauriReproArtifactV1 = {
      version: "tauri-repro-v1",
      createdAtMs: startedAtMs,
      redaction: {
        messageTextRedacted: true,
      },
      env: {
        userAgent: window.navigator.userAgent,
        runtimeMode: import.meta.env.MODE,
        ...(convexUrlHost ? { convexUrlHost } : {}),
      },
      commands,
      observed,
      diagnostics: {
        errorClasses: classifyReproErrorClasses(commands, observed),
      },
    };
    const fileName = `tauri-repro-${new Date(startedAtMs).toISOString().replaceAll(":", "-")}.json`;
    const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" });
    const href = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = href;
    anchor.download = fileName;
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    window.URL.revokeObjectURL(href);
    setLastReproArtifactName(fileName);
    addToast("success", `Repro artifact exported: ${fileName}`);
  }, [addToast]);

  // ── Effect: repro invoke capture subscription ──────────────────────────────

  useEffect(() => {
    return subscribeTauriInvokeCapture((event) => {
      if (!reproRecording) {
        return;
      }
      reproCommandsRef.current.push({
        tsMs: event.tsMs,
        phase: event.phase,
        command: event.command,
        ...(event.args !== undefined ? { args: event.args } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
      });
      if (event.phase === "invoke_start") {
        setLastCapturedInvokeCommand(event.command);
      }
    });
  }, [reproRecording]);

  // ── Observed event callback (passed to useCodexTauriEvents) ────────────────

  const onObservedEvent = useCallback(
    (event: { tsMs: number; kind: TauriReproObservedEvent["kind"]; payload: unknown }) => {
      if (!reproRecording) {
        return;
      }
      reproObservedRef.current.push({
        tsMs: event.tsMs,
        kind: event.kind,
        payload: event.payload,
      });
    },
    [reproRecording],
  );

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    reproRecording,
    reproCommandCount: reproCommandsRef.current.length,
    reproObservedCount: reproObservedRef.current.length,
    lastCapturedInvokeCommand,
    lastReproArtifactName,
    startReproRecording,
    stopReproRecording,
    exportReproRecording,
    onObservedEvent,
  };
}
