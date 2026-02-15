type ProtocolNotification = {
  method: string;
  params?: unknown;
};

type ProtocolError = {
  message: string;
  code: number;
};

type ProtocolResponse = {
  id: number;
  error?: ProtocolError;
};

export function parseServerInboundMessage(payloadJson: string): unknown {
  return JSON.parse(payloadJson) as unknown;
}

export function isServerNotification(message: unknown): message is ProtocolNotification {
  return typeof message === "object" && message !== null && "method" in message;
}

export function isResponse(message: unknown): message is ProtocolResponse {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  return "id" in message && !isServerNotification(message);
}

export function extractAssistantDelta(message: unknown): string | null {
  if (!isServerNotification(message)) {
    return null;
  }
  if (message.method !== "item/agentMessage/delta") {
    return null;
  }

  const params =
    typeof message.params === "object" && message.params !== null
      ? (message.params as Record<string, unknown>)
      : null;
  return typeof params?.delta === "string" ? params.delta : null;
}

export function extractAssistantDeltaFromPayload(payloadJson: string): string | null {
  return extractAssistantDelta(parseServerInboundMessage(payloadJson));
}
