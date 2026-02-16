import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const contractPath = join(appRoot, "bridge", "command-contract.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));

const commands = Array.isArray(contract.commands) ? contract.commands : [];
const tauriCommands = commands.filter((command) => typeof command.tauriCommand === "string");
const permissionCommands = tauriCommands.filter((command) => command.permission === true);
const helperCommands = commands.filter((command) => typeof command.helperType === "string");

function toKebabCase(value) {
  return value.replaceAll("_", "-");
}

function emitInvokeArgs(command) {
  if (!command.argName) {
    return "";
  }
  switch (command.argEnvelope) {
    case "config":
      return `{ config }`;
    case "configDefaultEmptyObject":
      return `{ config: config ?? {} }`;
    case "text":
      return `{ text }`;
    default:
      return `{ ${command.argName} }`;
  }
}

function generateTauriBridgeTs() {
  const lines = [];
  lines.push("// AUTO-GENERATED FILE. DO NOT EDIT.");
  lines.push("// Source: bridge/command-contract.json");
  lines.push('import { invoke } from "@tauri-apps/api/core";');
  lines.push("");
  lines.push("export type ActorContext = {");
  lines.push("  userId?: string;");
  lines.push("};");
  lines.push("");
  lines.push("export type BridgeState = {");
  lines.push("  running: boolean;");
  lines.push("  localThreadId: string | null;");
  lines.push("  turnId: string | null;");
  lines.push("  lastErrorCode?: string | null;");
  lines.push("  lastError: string | null;");
  lines.push("  runtimeThreadId?: string | null;");
  lines.push("  disabledTools?: string[];");
  lines.push("  pendingServerRequestCount?: number | null;");
  lines.push("  ingestEnqueuedEventCount?: number | null;");
  lines.push("  ingestSkippedEventCount?: number | null;");
  lines.push("  ingestEnqueuedByKind?: Array<{ kind: string; count: number }> | null;");
  lines.push("  ingestSkippedByKind?: Array<{ kind: string; count: number }> | null;");
  lines.push("};");
  lines.push("");
  lines.push('export type CommandApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";');
  lines.push("export type ToolUserInputAnswer = { answers: string[] };");
  lines.push("export type LoginAccountParams =");
  lines.push('  | { type: "apiKey"; apiKey: string }');
  lines.push('  | { type: "chatgpt" }');
  lines.push("  | {");
  lines.push('      type: "chatgptAuthTokens";');
  lines.push("      accessToken: string;");
  lines.push("      chatgptAccountId: string;");
  lines.push("      chatgptPlanType?: string | null;");
  lines.push("    };");
  lines.push("");
  lines.push("export type StartBridgeConfig = {");
  lines.push("  convexUrl: string;");
  lines.push("  actor: ActorContext;");
  lines.push("  sessionId: string;");
  lines.push("  startSource?: string;");
  lines.push("  model?: string;");
  lines.push("  cwd?: string;");
  lines.push("  disabledTools?: string[];");
  lines.push("  deltaThrottleMs?: number;");
  lines.push("  saveStreamDeltas?: boolean;");
  lines.push('  threadStrategy?: "start" | "resume" | "fork";');
  lines.push("  runtimeThreadId?: string;");
  lines.push("  externalThreadId?: string;");
  lines.push("};");
  lines.push("");
  for (const command of tauriCommands) {
    const returnType = command.returnType ?? "Promise<unknown>";
    if (command.argName) {
      const argToken = command.argOptional
        ? `${command.argName}?: ${command.argType}`
        : `${command.argName}: ${command.argType}`;
      lines.push(`export async function ${command.jsFunction}(${argToken}): ${returnType} {`);
      const invokeArgs = emitInvokeArgs(command);
      lines.push(`  return await invoke("${command.tauriCommand}"${invokeArgs ? `, ${invokeArgs}` : ""});`);
      lines.push("}");
    } else {
      lines.push(`export async function ${command.jsFunction}(): ${returnType} {`);
      lines.push(`  return await invoke("${command.tauriCommand}");`);
      lines.push("}");
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function generateHelperContractTs() {
  const lines = [];
  lines.push("// AUTO-GENERATED FILE. DO NOT EDIT.");
  lines.push("// Source: bridge/command-contract.json");
  lines.push('import type { v2 } from "@zakstam/codex-local-component/protocol";');
  lines.push("");
  lines.push("type CommandExecutionApprovalDecision = v2.CommandExecutionApprovalDecision;");
  lines.push("type FileChangeApprovalDecision = v2.FileChangeApprovalDecision;");
  lines.push("type ToolRequestUserInputAnswer = v2.ToolRequestUserInputAnswer;");
  lines.push("type LoginAccountParams = v2.LoginAccountParams;");
  lines.push("");
  lines.push("export type ActorContext = { userId?: string };");
  lines.push("export type StartPayload = {");
  lines.push("  convexUrl: string;");
  lines.push("  actor: ActorContext;");
  lines.push("  sessionId: string;");
  lines.push("  model?: string;");
  lines.push("  cwd?: string;");
  lines.push("  disabledTools?: string[];");
  lines.push("  deltaThrottleMs?: number;");
  lines.push("  saveStreamDeltas?: boolean;");
  lines.push('  threadStrategy?: "start" | "resume" | "fork";');
  lines.push("  runtimeThreadId?: string;");
  lines.push("  externalThreadId?: string;");
  lines.push("};");
  lines.push("");
  lines.push("export const HELPER_COMMAND_TYPES = [");
  for (const command of helperCommands) {
    lines.push(`  "${command.helperType}",`);
  }
  lines.push("] as const;");
  lines.push("");
  lines.push("const helperCommandTypeSet = new Set<string>(HELPER_COMMAND_TYPES);");
  lines.push("");
  lines.push("export type HelperCommand =");
  for (const command of helperCommands) {
    const payloadType = command.helperPayloadType;
    if (payloadType) {
      lines.push(`  | { type: "${command.helperType}"; payload: ${payloadType} }`);
    } else {
      lines.push(`  | { type: "${command.helperType}" }`);
    }
  }
  lines.push(";");
  lines.push("");
  lines.push("export function parseHelperCommand(line: string): HelperCommand {");
  lines.push("  const parsed = JSON.parse(line) as { type?: unknown; payload?: unknown };");
  lines.push('  if (typeof parsed !== "object" || parsed === null) {');
  lines.push('    throw new Error("Helper command must be an object.");');
  lines.push("  }");
  lines.push('  if (typeof parsed.type !== "string" || !helperCommandTypeSet.has(parsed.type)) {');
  lines.push('    throw new Error(`Unsupported helper command: ${String(parsed.type)}`);');
  lines.push("  }");
  lines.push('  if (parsed.type === "interrupt" || parsed.type === "stop" || parsed.type === "status") {');
  lines.push("    return { type: parsed.type } as HelperCommand;");
  lines.push("  }");
  lines.push('  if (!("payload" in parsed)) {');
  lines.push('    throw new Error(`Missing payload for helper command: ${parsed.type}`);');
  lines.push("  }");
  lines.push("  return parsed as HelperCommand;");
  lines.push("}");
  return `${lines.join("\n").trimEnd()}\n`;
}

function generateNodeDispatchTs() {
  const lines = [];
  lines.push("// AUTO-GENERATED FILE. DO NOT EDIT.");
  lines.push("// Source: bridge/command-contract.json");
  lines.push("");
  lines.push("export const HELPER_ACK_BY_TYPE = {");
  for (const command of helperCommands) {
    const shouldAck = command.helperType !== "start" && command.helperType !== "stop";
    lines.push(`  "${command.helperType}": ${shouldAck},`);
  }
  lines.push("} as const;");
  lines.push("");
  lines.push("export type HelperCommandType = keyof typeof HELPER_ACK_BY_TYPE;");
  lines.push("");
  lines.push("export const TAURI_TO_HELPER_COMMAND = {");
  for (const command of tauriCommands) {
    if (!command.helperType) {
      continue;
    }
    lines.push(`  "${command.tauriCommand}": "${command.helperType}",`);
  }
  lines.push("} as const;");
  lines.push("");
  lines.push("export function helperCommandForTauriCommand(tauriCommand: string): HelperCommandType | null {");
  lines.push("  return (TAURI_TO_HELPER_COMMAND as Record<string, HelperCommandType>)[tauriCommand] ?? null;");
  lines.push("}");
  return `${lines.join("\n").trimEnd()}\n`;
}

function generateRustContractRs() {
  const tauriCommandNames = tauriCommands.map((command) => command.tauriCommand);
  const helperCommandNames = helperCommands.map((command) => command.helperType);
  const lines = [];
  lines.push("// AUTO-GENERATED FILE. DO NOT EDIT.");
  lines.push("// Source: bridge/command-contract.json");
  lines.push("pub const BRIDGE_COMMANDS: &[&str] = &[");
  for (const name of tauriCommandNames) {
    lines.push(`    "${name}",`);
  }
  lines.push("];");
  lines.push("");
  lines.push("pub const HELPER_COMMANDS: &[&str] = &[");
  for (const name of helperCommandNames) {
    lines.push(`    "${name}",`);
  }
  lines.push("];");
  return `${lines.join("\n").trimEnd()}\n`;
}

function generateRustDispatchRs() {
  const lines = [];
  lines.push("// AUTO-GENERATED FILE. DO NOT EDIT.");
  lines.push("// Source: bridge/command-contract.json");
  lines.push("");
  lines.push("pub const HELPER_FORWARD_TAURI_COMMANDS: &[&str] = &[");
  for (const command of tauriCommands) {
    if (!command.helperType) {
      continue;
    }
    lines.push(`    \"${command.tauriCommand}\",`);
  }
  lines.push("];\n");
  lines.push("pub fn helper_command_for_tauri_command(tauri_command: &str) -> Option<&'static str> {");
  lines.push("    match tauri_command {");
  for (const command of tauriCommands) {
    if (!command.helperType) {
      continue;
    }
    lines.push(`        \"${command.tauriCommand}\" => Some(\"${command.helperType}\"),`);
  }
  lines.push("        _ => None,");
  lines.push("    }");
  lines.push("}");
  return `${lines.join("\n").trimEnd()}\n`;
}

function generateRustInvokeHandlersRs() {
  const lines = [];
  lines.push("// AUTO-GENERATED FILE. DO NOT EDIT.");
  lines.push("// Source: bridge/command-contract.json");
  lines.push("");
  lines.push("macro_rules! bridge_generate_handler {");
  lines.push("    () => {");
  lines.push("        tauri::generate_handler![");
  for (const command of tauriCommands) {
    lines.push(`            ${command.tauriCommand},`);
  }
  lines.push("        ]");
  lines.push("    };\n}");
  return `${lines.join("\n").trimEnd()}\n`;
}

function generatePermissionToml(commandName) {
  const slug = toKebabCase(commandName);
  return `# Automatically generated - DO NOT EDIT!

[[permission]]
identifier = "allow-${slug}"
description = "Enables the ${commandName} command without any pre-configured scope."
commands.allow = ["${commandName}"]

[[permission]]
identifier = "deny-${slug}"
description = "Denies the ${commandName} command without any pre-configured scope."
commands.deny = ["${commandName}"]
`;
}

function writeIfChanged(path, nextContent) {
  const prevContent = readFileSync(path, "utf8");
  if (prevContent === nextContent) {
    return false;
  }
  writeFileSync(path, nextContent);
  return true;
}

function safeWrite(path, nextContent) {
  try {
    return writeIfChanged(path, nextContent);
  } catch {
    writeFileSync(path, nextContent);
    return true;
  }
}

function main() {
  const tauriBridgePath = join(appRoot, "src", "lib", "tauriBridge.generated.ts");
  const helperContractPath = join(appRoot, "src-node", "bridge-contract.generated.ts");
  const nodeDispatchPath = join(appRoot, "src-node", "bridge-dispatch.generated.ts");
  const rustContractPath = join(appRoot, "src-tauri", "src", "bridge_contract_generated.rs");
  const rustDispatchPath = join(appRoot, "src-tauri", "src", "bridge_dispatch_generated.rs");
  const rustInvokeHandlersPath = join(
    appRoot,
    "src-tauri",
    "src",
    "bridge_invoke_handlers_generated.rs",
  );
  const permissionsDir = join(appRoot, "src-tauri", "permissions", "autogenerated");

  safeWrite(tauriBridgePath, generateTauriBridgeTs());
  safeWrite(helperContractPath, generateHelperContractTs());
  safeWrite(nodeDispatchPath, generateNodeDispatchTs());
  safeWrite(rustContractPath, generateRustContractRs());
  safeWrite(rustDispatchPath, generateRustDispatchRs());
  safeWrite(rustInvokeHandlersPath, generateRustInvokeHandlersRs());

  mkdirSync(permissionsDir, { recursive: true });
  const expectedPermissionFiles = new Set();
  for (const command of permissionCommands) {
    const filename = `${command.tauriCommand}.toml`;
    expectedPermissionFiles.add(filename);
    const filePath = join(permissionsDir, filename);
    safeWrite(filePath, generatePermissionToml(command.tauriCommand));
  }

  for (const existing of readdirSync(permissionsDir)) {
    if (!existing.endsWith(".toml")) {
      continue;
    }
    if (expectedPermissionFiles.has(existing)) {
      continue;
    }
    rmSync(join(permissionsDir, existing));
  }
}

main();
