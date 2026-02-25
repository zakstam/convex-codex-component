export type TerminalTurnStatus = "completed" | "failed" | "interrupted";

export const TERMINAL_TURN_STATUS_PRIORITY: Record<TerminalTurnStatus, number> = {
  completed: 1,
  interrupted: 2,
  failed: 3,
};

