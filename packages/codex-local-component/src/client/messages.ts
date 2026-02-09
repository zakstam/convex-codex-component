import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner } from "./types.js";

type MessagesComponent = {
  messages: {
    listByThread: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    getByTurn: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

export async function listMessages<Component extends MessagesComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["messages"]["listByThread"]>,
): Promise<FunctionReturnType<Component["messages"]["listByThread"]>> {
  return ctx.runQuery(component.messages.listByThread, args);
}

export async function listTurnMessages<Component extends MessagesComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["messages"]["getByTurn"]>,
): Promise<FunctionReturnType<Component["messages"]["getByTurn"]>> {
  return ctx.runQuery(component.messages.getByTurn, args);
}
