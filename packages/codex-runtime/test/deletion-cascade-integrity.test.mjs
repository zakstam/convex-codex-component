import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaSource = readFileSync(new URL("../src/component/schema.ts", import.meta.url), "utf8");
const deletionCascadeSource = readFileSync(new URL("../src/component/deletionCascade.ts", import.meta.url), "utf8");

test("stream deltas define a streamRef cursor index for ref-based deletion", () => {
  assert.equal(
    schemaSource.includes('.index("userScope_streamRef_cursorStart", ["userScope", "streamRef", "cursorStart"])'),
    true,
  );
});

test("thread and turn delta deletion scan by streamRef and retire drained streams", () => {
  assert.equal(deletionCascadeSource.includes('withIndex("userScope_streamRef_cursorStart"'), true);
  assert.equal(deletionCascadeSource.includes('q.eq("userScope", args.userScope).eq("streamRef", stream._id)'), true);
  assert.equal(deletionCascadeSource.includes('withIndex("userScope_streamRef", (q) =>'), true);
  assert.equal(deletionCascadeSource.includes('await args.ctx.db.delete(stream._id);'), true);
});
