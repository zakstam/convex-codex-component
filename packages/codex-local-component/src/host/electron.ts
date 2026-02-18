import type { LoginAccountParams as ProtocolLoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";
import type {
  BridgeClient,
  BridgeState,
  CommandApprovalDecision,
  StartBridgeConfig,
  ToolUserInputAnswer,
} from "./bridge.js";

export type {
  ActorContext,
  BridgeClient,
  BridgeState,
  CommandApprovalDecision,
  LoginAccountParams,
  StartBridgeConfig,
  StartPayload,
  ToolUserInputAnswer,
} from "./bridge.js";

export type ElectronInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export function createElectronBridgeClient(invoke: ElectronInvoke): BridgeClient {
  return {
    lifecycle: {
      start(config: StartBridgeConfig): Promise<unknown> {
        return invoke("codex:start_bridge", config);
      },
      stop(): Promise<unknown> {
        return invoke("codex:stop_bridge");
      },
      getState(): Promise<BridgeState> {
        return invoke("codex:get_bridge_state") as Promise<BridgeState>;
      },
    },
    turns: {
      send(text: string): Promise<unknown> {
        return invoke("codex:send_user_turn", text);
      },
      interrupt(): Promise<unknown> {
        return invoke("codex:interrupt_turn");
      },
    },
    approvals: {
      respondCommand(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown> {
        return invoke("codex:respond_command_approval", config);
      },
      respondFileChange(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown> {
        return invoke("codex:respond_file_change_approval", config);
      },
      respondToolInput(config: { requestId: string | number; answers: Record<string, ToolUserInputAnswer> }): Promise<unknown> {
        return invoke("codex:respond_tool_user_input", config);
      },
    },
    account: {
      read(config?: { refreshToken?: boolean }): Promise<unknown> {
        return invoke("codex:read_account", config ?? {});
      },
      login(config: { params: ProtocolLoginAccountParams }): Promise<unknown> {
        return invoke("codex:login_account", config);
      },
      cancelLogin(config: { loginId: string }): Promise<unknown> {
        return invoke("codex:cancel_account_login", config);
      },
      logout(): Promise<unknown> {
        return invoke("codex:logout_account");
      },
      readRateLimits(): Promise<unknown> {
        return invoke("codex:read_account_rate_limits");
      },
      respondChatgptAuthTokensRefresh(config: {
        requestId: string | number;
        accessToken: string;
        chatgptAccountId: string;
        chatgptPlanType?: string | null;
      }): Promise<unknown> {
        return invoke("codex:respond_chatgpt_auth_tokens_refresh", config);
      },
    },
    tools: {
      setDisabled(config: { tools: string[] }): Promise<unknown> {
        return invoke("codex:set_disabled_tools", config);
      },
    },
  };
}
