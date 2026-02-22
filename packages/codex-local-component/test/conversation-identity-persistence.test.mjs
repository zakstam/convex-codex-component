import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaSource = readFileSync(new URL("../src/component/schema.ts", import.meta.url), "utf8");
const threadsSource = readFileSync(new URL("../src/component/threads.ts", import.meta.url), "utf8");
const actorTypesSource = readFileSync(new URL("../src/component/types.ts", import.meta.url), "utf8");
const scopeSource = readFileSync(new URL("../src/component/scope.ts", import.meta.url), "utf8");
const threadBindingsBlock = schemaSource.match(
  /codex_thread_bindings:\s*defineTable\(\{[\s\S]*?\}\)\s*\.index\("userScope_userId_conversationId"/,
)?.[0] ?? "";

test("thread binding persistence uses conversation identity naming", () => {
  assert.equal(threadBindingsBlock.includes("threadHandle:"), false);
  assert.equal(threadBindingsBlock.includes("runtimeThreadId:"), false);
  assert.equal(threadBindingsBlock.includes("threadRef: v.id(\"codex_threads\")"), false);
  assert.equal(threadBindingsBlock.includes("conversationRef: v.id(\"codex_threads\")"), true);
  assert.equal(threadBindingsBlock.includes("runtimeConversationId:"), true);
});

test("thread binding APIs avoid thread-handle aliases and runtimeThreadId naming", () => {
  assert.equal(threadsSource.includes("resolveByThreadHandle"), false);
  assert.equal(threadsSource.includes("getThreadHandleMapping"), false);
  assert.equal(threadsSource.includes("threadHandle"), false);
  assert.equal(threadsSource.includes("runtimeThreadId"), false);
  assert.equal(threadsSource.includes("runtimeConversationId"), true);
});

test("actor contract supports anonymous isolation ids", () => {
  assert.equal(actorTypesSource.includes("anonymousId: v.optional(v.string())"), true);
  assert.equal(actorTypesSource.includes("anonymousId?: string"), true);
});

test("scope derivation uses anonymous ids before shared anonymous fallback", () => {
  assert.equal(scopeSource.includes("const anonymousId = actor.anonymousId?.trim();"), true);
  assert.equal(scopeSource.includes("return `anon:${anonymousId}`;"), true);
});
