/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvals from "../approvals.js";
import type * as index from "../index.js";
import type * as sessions from "../sessions.js";
import type * as streams from "../streams.js";
import type * as sync from "../sync.js";
import type * as threads from "../threads.js";
import type * as turns from "../turns.js";
import type * as turnsInternal from "../turnsInternal.js";
import type * as types from "../types.js";
import type * as utils from "../utils.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  approvals: typeof approvals;
  index: typeof index;
  sessions: typeof sessions;
  streams: typeof streams;
  sync: typeof sync;
  threads: typeof threads;
  turns: typeof turns;
  turnsInternal: typeof turnsInternal;
  types: typeof types;
  utils: typeof utils;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
