"use client";

import type { OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";

type AnyPublicQuery = FunctionReference<"query", "public", Record<string, unknown>, unknown>;

export function toOptionalRestArgsOrSkip<Query extends AnyPublicQuery>(
  args: FunctionArgs<Query> | "skip",
): OptionalRestArgsOrSkip<Query> {
  if (args === "skip") {
    return ["skip"] as OptionalRestArgsOrSkip<Query>;
  }
  return [args] as OptionalRestArgsOrSkip<Query>;
}
