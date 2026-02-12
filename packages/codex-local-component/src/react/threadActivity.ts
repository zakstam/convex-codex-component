"use client";

import {
  deriveCodexActivityByAuthorityRules,
  type CodexThreadActivity,
  type CodexThreadActivityActiveStreamLike,
  type CodexThreadActivityDispatchLike,
  type CodexThreadActivityLifecycleMarkerLike,
  type CodexThreadActivityMessageLike,
  type CodexThreadActivityPhase,
  type CodexThreadActivityStreamStatLike,
  type CodexThreadActivityThreadState,
  type CodexThreadActivityTurnLike,
} from "./activityAuthority.js";

export type {
  CodexThreadActivity,
  CodexThreadActivityPhase,
  CodexThreadActivityMessageLike,
  CodexThreadActivityDispatchLike,
  CodexThreadActivityStreamStatLike,
  CodexThreadActivityTurnLike,
  CodexThreadActivityActiveStreamLike,
  CodexThreadActivityLifecycleMarkerLike,
  CodexThreadActivityThreadState,
};

export function deriveCodexThreadActivity(
  state: CodexThreadActivityThreadState | null | undefined,
): CodexThreadActivity {
  return deriveCodexActivityByAuthorityRules(state);
}
