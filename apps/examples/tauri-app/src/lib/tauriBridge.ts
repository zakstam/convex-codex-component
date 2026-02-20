import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createTauriBridgeClient } from "@zakstam/codex-local-component/host/tauri";
import type { BridgeState } from "@zakstam/codex-local-component/host/tauri";

export type {
  ActorContext,
  BridgeState,
  CommandApprovalDecision,
  LoginAccountParams,
  StartBridgeConfig,
  ToolUserInputAnswer,
} from "@zakstam/codex-local-component/host/tauri";

export const bridge = createTauriBridgeClient(
  (command, args) => invoke(command, args),
  {
    lifecycleSafeSend: true,
    subscribeBridgeState: async (listener) => {
      return listen<BridgeState>("codex:bridge_state", (event) => {
        listener(event.payload);
      });
    },
  },
);
