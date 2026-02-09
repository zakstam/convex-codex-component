import type {
  AddConversationSubscriptionResponse,
  ApplyPatchApprovalResponse,
  ArchiveConversationResponse,
  CancelLoginChatGptResponse,
  ClientNotification,
  ClientRequest,
  ExecCommandApprovalResponse,
  ExecOneOffCommandResponse,
  ForkConversationResponse,
  FuzzyFileSearchResponse,
  GetAuthStatusResponse,
  GetConversationSummaryResponse,
  GetUserAgentResponse,
  GetUserSavedConfigResponse,
  GitDiffToRemoteResponse,
  InitializeResponse,
  InterruptConversationResponse,
  ListConversationsResponse,
  LoginApiKeyResponse,
  LoginChatGptResponse,
  LogoutChatGptResponse,
  NewConversationResponse,
  RemoveConversationSubscriptionResponse,
  ResumeConversationResponse,
  SendUserMessageResponse,
  SendUserTurnResponse,
  ServerNotification,
  ServerRequest,
  SetDefaultModelResponse,
  UserInfoResponse,
  EventMsg,
} from "./schemas/index.js";
import type {
  AppsListResponse,
  CancelLoginAccountResponse,
  ChatgptAuthTokensRefreshResponse,
  CommandExecResponse,
  CommandExecutionRequestApprovalResponse,
  ConfigReadResponse,
  ConfigRequirementsReadResponse,
  ConfigWriteResponse,
  DynamicToolCallResponse,
  FeedbackUploadResponse,
  FileChangeRequestApprovalResponse,
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  ListMcpServerStatusResponse,
  LoginAccountResponse,
  LogoutAccountResponse,
  McpServerOauthLoginResponse,
  McpServerRefreshResponse,
  ModelListResponse,
  ReviewStartResponse,
  SkillsConfigWriteResponse,
  SkillsListResponse,
  SkillsRemoteReadResponse,
  SkillsRemoteWriteResponse,
  ThreadArchiveResponse,
  ThreadCompactStartResponse,
  ThreadForkResponse,
  ThreadListResponse,
  ThreadLoadedListResponse,
  ThreadReadResponse,
  ThreadResumeResponse,
  ThreadRollbackResponse,
  ThreadSetNameResponse,
  ThreadStartResponse,
  ThreadUnarchiveResponse,
  ToolRequestUserInputResponse,
  TurnInterruptResponse,
  TurnStartResponse,
} from "./schemas/v2/index.js";

export type RpcId = number | string;

export type GeneratedResponsePayload =
  | AddConversationSubscriptionResponse
  | ApplyPatchApprovalResponse
  | ArchiveConversationResponse
  | AppsListResponse
  | CancelLoginAccountResponse
  | CancelLoginChatGptResponse
  | ChatgptAuthTokensRefreshResponse
  | CommandExecResponse
  | CommandExecutionRequestApprovalResponse
  | ConfigReadResponse
  | ConfigRequirementsReadResponse
  | ConfigWriteResponse
  | DynamicToolCallResponse
  | ExecCommandApprovalResponse
  | ExecOneOffCommandResponse
  | FeedbackUploadResponse
  | FileChangeRequestApprovalResponse
  | ForkConversationResponse
  | FuzzyFileSearchResponse
  | GetAccountRateLimitsResponse
  | GetAccountResponse
  | GetAuthStatusResponse
  | GetConversationSummaryResponse
  | GetUserAgentResponse
  | GetUserSavedConfigResponse
  | GitDiffToRemoteResponse
  | InitializeResponse
  | InterruptConversationResponse
  | ListConversationsResponse
  | ListMcpServerStatusResponse
  | LoginAccountResponse
  | LoginApiKeyResponse
  | LoginChatGptResponse
  | LogoutAccountResponse
  | LogoutChatGptResponse
  | McpServerOauthLoginResponse
  | McpServerRefreshResponse
  | ModelListResponse
  | NewConversationResponse
  | RemoveConversationSubscriptionResponse
  | ResumeConversationResponse
  | ReviewStartResponse
  | SendUserMessageResponse
  | SendUserTurnResponse
  | SetDefaultModelResponse
  | SkillsConfigWriteResponse
  | SkillsListResponse
  | SkillsRemoteReadResponse
  | SkillsRemoteWriteResponse
  | ThreadArchiveResponse
  | ThreadCompactStartResponse
  | ThreadForkResponse
  | ThreadListResponse
  | ThreadLoadedListResponse
  | ThreadReadResponse
  | ThreadResumeResponse
  | ThreadRollbackResponse
  | ThreadSetNameResponse
  | ThreadStartResponse
  | ThreadUnarchiveResponse
  | ToolRequestUserInputResponse
  | TurnInterruptResponse
  | TurnStartResponse
  | UserInfoResponse;

export type CodexResponse = {
  id: RpcId;
  result?: GeneratedResponsePayload;
  error?: {
    code: number;
    message: string;
  };
};

export type ClientOutboundMessage = ClientRequest | ClientNotification;
export type LegacyEventNotification = {
  method: `codex/event/${string}`;
  params: {
    conversationId: string;
    msg: EventMsg;
    id?: string;
  };
};
export type ServerInboundMessage =
  | ServerNotification
  | ServerRequest
  | CodexResponse
  | LegacyEventNotification;
export type CodexWireMessage = ClientOutboundMessage | ServerInboundMessage;

export type NormalizedEvent = {
  eventId: string;
  threadId: string;
  turnId?: string;
  streamId?: string;
  cursorStart: number;
  cursorEnd: number;
  kind: string;
  payloadJson: string;
  createdAt: number;
};
