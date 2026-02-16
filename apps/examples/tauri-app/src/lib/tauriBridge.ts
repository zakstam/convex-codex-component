import { invoke } from "@tauri-apps/api/core";
import { createTauriBridgeClient } from "@zakstam/codex-local-component/host/tauri";

export type {
  ActorContext,
  BridgeState,
  CommandApprovalDecision,
  LoginAccountParams,
  StartBridgeConfig,
  ToolUserInputAnswer,
} from "@zakstam/codex-local-component/host/tauri";

const bridge = createTauriBridgeClient((command, args) => invoke(command, args));

export const {
  startBridge,
  sendUserTurn,
  interruptTurn,
  respondCommandApproval,
  respondFileChangeApproval,
  respondToolUserInput,
  readAccount,
  loginAccount,
  cancelAccountLogin,
  logoutAccount,
  readAccountRateLimits,
  respondChatgptAuthTokensRefresh,
  setDisabledTools,
  stopBridge,
  getBridgeState,
} = bridge;
