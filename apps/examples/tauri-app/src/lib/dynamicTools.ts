export const KNOWN_DYNAMIC_TOOLS = [
  "tauri_get_runtime_snapshot",
] as const;

export const TAURI_RUNTIME_TOOL_NAME = KNOWN_DYNAMIC_TOOLS[0];

export const TAURI_RUNTIME_TOOL_PROMPT = `Use the dynamic tool \`${TAURI_RUNTIME_TOOL_NAME}\` with includePendingRequests=true and summarize the response.`;
