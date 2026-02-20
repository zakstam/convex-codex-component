import readline from "node:readline";

export function printHelp(): void {
  console.log([
    "Commands:",
    "  start",
    "  open-thread [start|resume|fork] [threadHandle]",
    "  send <text>",
    "  interrupt",
    "  status",
    "  stop",
    "  approve-command <requestId> <decision>",
    "  approve-file <requestId> <decision>",
    "  tool-input <requestId> <jsonAnswers>",
    "  account-read [true|false]",
    "  account-login <jsonParams>",
    "  account-cancel <loginId>",
    "  account-logout",
    "  account-rate-limits",
    "  auth-refresh <requestId> <accessToken> <chatgptAccountId> [chatgptPlanType]",
    "  disable-tools <tool1,tool2,...>",
    "  raw",
    "  timeline",
    "  save-trace",
    "  help",
    "  exit",
  ].join("\n"));
}

export function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "debug-harness> ",
  });
}
