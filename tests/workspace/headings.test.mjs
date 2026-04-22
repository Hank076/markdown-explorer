import test from "node:test";
import assert from "node:assert/strict";
import { buildHeadingRecords } from "../../app/workspace/headings.js";

test("buildHeadingRecords dedupes repeated headings", () => {
  const records = buildHeadingRecords([
    { text: "Install", level: 2 },
    { text: "Install", level: 2 },
    { text: "Install", level: 3 },
  ]);

  assert.deepEqual(
    records.map((record) => record.id),
    ["install", "install-2", "install-3"],
  );
});

test("buildHeadingRecords preserves non-Latin text", () => {
  const records = buildHeadingRecords([{ text: "安裝步驟", level: 2 }]);
  assert.equal(records[0].id, "安裝步驟");
});
