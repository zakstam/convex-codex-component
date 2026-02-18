export const KNOWN_DYNAMIC_TOOLS = [
  "electron_get_runtime_snapshot",
] as const;

export const ELECTRON_RUNTIME_TOOL_NAME = KNOWN_DYNAMIC_TOOLS[0];

export const ELECTRON_RUNTIME_TOOL_PROMPT = `Use the dynamic tool \`${ELECTRON_RUNTIME_TOOL_NAME}\` with includePendingRequests=true and summarize the response.`;
