import { createElectronBridgeClient } from "@zakstam/codex-local-component/host/electron";

export type {
  ActorContext,
  BridgeState,
  CommandApprovalDecision,
  LoginAccountParams,
  StartBridgeConfig,
  ToolUserInputAnswer,
} from "@zakstam/codex-local-component/host/electron";

declare global {
  interface Window {
    electronCodex: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

export const bridge = createElectronBridgeClient(
  (channel: string, ...args: unknown[]) => window.electronCodex.invoke(channel, ...args),
);
