import test from "node:test";
import assert from "node:assert/strict";
import { resolveActorFromAuth } from "../dist/host/index.js";

test("resolveActorFromAuth derives actor userId from auth identity", async () => {
  const actor = await resolveActorFromAuth(
    {
      auth: {
        getUserIdentity: async () => ({ subject: "user-1" }),
      },
    },
    {},
  );

  assert.deepEqual(actor, { userId: "user-1" });
});

test("resolveActorFromAuth rejects mismatched requested actor", async () => {
  await assert.rejects(
    resolveActorFromAuth(
      {
        auth: {
          getUserIdentity: async () => ({ subject: "user-1" }),
        },
      },
      { userId: "user-2" },
    ),
    /\[E_AUTH_SESSION_FORBIDDEN\]/,
  );
});

test("resolveActorFromAuth allows anonymous actor when identity is missing", async () => {
  const actor = await resolveActorFromAuth(
    {
      auth: {
        getUserIdentity: async () => null,
      },
    },
    {},
  );

  assert.deepEqual(actor, {});
});

test("resolveActorFromAuth rejects explicit userId when identity is missing", async () => {
  await assert.rejects(
    resolveActorFromAuth(
      {
        auth: {
          getUserIdentity: async () => null,
        },
      },
      { userId: "user-1" },
    ),
    /\[E_AUTH_SESSION_FORBIDDEN\]/,
  );
});
