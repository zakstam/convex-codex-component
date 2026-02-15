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
import type * as ingest_applyApprovals from "../ingest/applyApprovals.js";
import type * as ingest_applyMessages from "../ingest/applyMessages.js";
import type * as ingest_applyStreams from "../ingest/applyStreams.js";
import type * as ingest_applyTurns from "../ingest/applyTurns.js";
import type * as ingest_checkpoints from "../ingest/checkpoints.js";
import type * as ingest_index from "../ingest/index.js";
import type * as ingest_normalize from "../ingest/normalize.js";
import type * as ingest_postIngest from "../ingest/postIngest.js";
import type * as ingest_sessionGuard from "../ingest/sessionGuard.js";
import type * as ingest_stateCache from "../ingest/stateCache.js";
import type * as ingest_types from "../ingest/types.js";
import type * as messages from "../messages.js";
import type * as pagination from "../pagination.js";
import type * as reasoning from "../reasoning.js";
import type * as scope from "../scope.js";
import type * as serverRequests from "../serverRequests.js";
import type * as sessions from "../sessions.js";
import type * as streamStats from "../streamStats.js";
import type * as streams from "../streams.js";
import type * as sync from "../sync.js";
import type * as syncHelpers from "../syncHelpers.js";
import type * as syncIngest from "../syncIngest.js";
import type * as syncReplay from "../syncReplay.js";
import type * as syncRuntime from "../syncRuntime.js";
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

type GeneratedApiModules = {
  approvals: typeof approvals;
  index: typeof index;
  "ingest/applyApprovals": typeof ingest_applyApprovals;
  "ingest/applyMessages": typeof ingest_applyMessages;
  "ingest/applyStreams": typeof ingest_applyStreams;
  "ingest/applyTurns": typeof ingest_applyTurns;
  "ingest/checkpoints": typeof ingest_checkpoints;
  "ingest/index": typeof ingest_index;
  "ingest/normalize": typeof ingest_normalize;
  "ingest/postIngest": typeof ingest_postIngest;
  "ingest/sessionGuard": typeof ingest_sessionGuard;
  "ingest/stateCache": typeof ingest_stateCache;
  "ingest/types": typeof ingest_types;
  messages: typeof messages;
  pagination: typeof pagination;
  reasoning: typeof reasoning;
  scope: typeof scope;
  serverRequests: typeof serverRequests;
  sessions: typeof sessions;
  streamStats: typeof streamStats;
  streams: typeof streams;
  sync: typeof sync;
  syncHelpers: typeof syncHelpers;
  syncIngest: typeof syncIngest;
  syncReplay: typeof syncReplay;
  syncRuntime: typeof syncRuntime;
  threads: typeof threads;
  turns: typeof turns;
  turnsInternal: typeof turnsInternal;
  types: typeof types;
  utils: typeof utils;
};
const fullApi: ApiFromModules<GeneratedApiModules> = anyApi as unknown as ApiFromModules<GeneratedApiModules>;

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
  FunctionReference<"query" | "mutation", "public">
> = fullApi;

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
  FunctionReference<"query" | "mutation", "internal">
> = fullApi;

export const components = componentsGeneric() as unknown as {};
