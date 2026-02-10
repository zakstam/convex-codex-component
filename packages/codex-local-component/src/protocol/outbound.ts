import type { ClientNotification } from "./schemas/ClientNotification.js";
import type { ClientRequest } from "./schemas/ClientRequest.js";
import type { RequestId } from "./schemas/RequestId.js";
import type { CommandExecutionRequestApprovalResponse } from "./schemas/v2/CommandExecutionRequestApprovalResponse.js";
import type { DynamicToolCallResponse } from "./schemas/v2/DynamicToolCallResponse.js";
import type { FileChangeRequestApprovalResponse } from "./schemas/v2/FileChangeRequestApprovalResponse.js";
import type { ToolRequestUserInputResponse } from "./schemas/v2/ToolRequestUserInputResponse.js";

export type ClientServerRequestResponse = {
  id: RequestId;
  result:
    | CommandExecutionRequestApprovalResponse
    | DynamicToolCallResponse
    | FileChangeRequestApprovalResponse
    | ToolRequestUserInputResponse;
};

export type ClientOutboundWireMessage =
  | ClientRequest
  | ClientNotification
  | ClientServerRequestResponse;
