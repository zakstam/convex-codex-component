"use client";

import type { DynamicToolCallOutputContentItem } from "../protocol/schemas/v2/DynamicToolCallOutputContentItem.js";

export type CodexDynamicToolServerRequest = {
  requestId: string | number;
  method:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/tool/requestUserInput"
    | "item/tool/call";
  conversationId: string;
  turnId: string;
  itemId: string;
  payloadJson: string;
  createdAt?: number;
};

export type CodexDynamicToolCall = {
  requestId: string | number;
  conversationId: string;
  turnId: string;
  itemId: string;
  callId?: string;
  toolName: string;
  input: unknown;
  createdAt?: number;
  request: CodexDynamicToolServerRequest;
};

export type CodexDynamicToolResponse = {
  success: boolean;
  contentItems: DynamicToolCallOutputContentItem[];
};

type ParsedToolCallPayload = {
  callId?: string;
  toolName: string;
  input: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function parseCodexDynamicToolPayload(payloadJson: string): ParsedToolCallPayload | null {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    const root = asObject(parsed);
    if (!root || root.method !== "item/tool/call") {
      return null;
    }
    const params = asObject(root.params);
    if (!params) {
      return null;
    }
    const toolName = typeof params.tool === "string" ? params.tool : null;
    if (!toolName) {
      return null;
    }
    return {
      ...(typeof params.callId === "string" ? { callId: params.callId } : {}),
      toolName,
      input: params.arguments,
    };
  } catch (error) {
    console.warn("[dynamicTools] Failed to parse dynamic tool payload JSON:", error);
    return null;
  }
}

export function deriveCodexDynamicToolCalls(
  requests: CodexDynamicToolServerRequest[] | null | undefined,
): CodexDynamicToolCall[] {
  const list = requests ?? [];
  const results: CodexDynamicToolCall[] = [];
  for (const request of list) {
    if (request.method !== "item/tool/call") {
      continue;
    }
    const parsed = parseCodexDynamicToolPayload(request.payloadJson);
    if (!parsed) {
      continue;
    }
    results.push({
      requestId: request.requestId,
      conversationId: request.conversationId,
      turnId: request.turnId,
      itemId: request.itemId,
      ...(parsed.callId ? { callId: parsed.callId } : {}),
      toolName: parsed.toolName,
      input: parsed.input,
      ...(request.createdAt !== undefined ? { createdAt: request.createdAt } : {}),
      request,
    });
  }
  return results;
}
