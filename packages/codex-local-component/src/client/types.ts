import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { Doc } from "../component/_generated/dataModel.js";
import type { ComponentApi } from "../component/_generated/component.js";

type AnyQueryRef = FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
type AnyMutationRef = FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;

export type CodexComponent = ComponentApi;

export type CodexQueryRunner = {
  runQuery<Query extends AnyQueryRef>(
    query: Query,
    args: FunctionArgs<Query>,
  ): Promise<FunctionReturnType<Query>>;
};

export type CodexMutationRunner = {
  runMutation<Mutation extends AnyMutationRef>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
  ): Promise<FunctionReturnType<Mutation>>;
};

export type CodexActorContext = FunctionArgs<
  ComponentApi["threads"]["getState"]
>["actor"];

export type CodexMessageDoc = Doc<"codex_messages">;

export type CodexUIMessage = {
  messageId: string;
  turnId: string;
  role: CodexMessageDoc["role"];
  status: CodexMessageDoc["status"];
  text: string;
  orderInTurn: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
};

export type CodexStreamOverlay = FunctionReturnType<
  ComponentApi["sync"]["replay"]
>;

type RuntimeOptionsFromPullState = FunctionArgs<
  ComponentApi["sync"]["replay"]
> extends {
  runtime?: infer Runtime;
}
  ? Runtime
  : never;

type RuntimeOptionsFromResume = FunctionArgs<
  ComponentApi["sync"]["resumeReplay"]
> extends {
  runtime?: infer Runtime;
}
  ? Runtime
  : never;

export type CodexSyncRuntimeOptions =
  | RuntimeOptionsFromPullState
  | RuntimeOptionsFromResume;
