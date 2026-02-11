import type {
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner, GenericQueryRef } from "./types.js";

type MessagesComponent = {
  messages: {
    listByThread: GenericQueryRef;
    getByTurn: GenericQueryRef;
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
