import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceRelativeHref, createAssetUrlRegistry } from "../../app/workspace/assets.js";

test("isWorkspaceRelativeHref returns true for local relative paths", () => {
  assert.equal(isWorkspaceRelativeHref("./images/cover.png"), true);
  assert.equal(isWorkspaceRelativeHref("../files/spec.pdf"), true);
});

test("isWorkspaceRelativeHref rejects external and anchor-only links", () => {
  assert.equal(isWorkspaceRelativeHref("https://example.com"), false);
  assert.equal(isWorkspaceRelativeHref("#install"), false);
  assert.equal(isWorkspaceRelativeHref("data:image/png;base64,AAA"), false);
  assert.equal(isWorkspaceRelativeHref("blob:https://example.com/uuid"), false);
  assert.equal(isWorkspaceRelativeHref("tel:+886123456789"), false);
});

test("createAssetUrlRegistry revokes previous URLs", () => {
  const revoked = [];
  const registry = createAssetUrlRegistry({
    createObjectURL: (value) => `blob:${value}`,
    revokeObjectURL: (value) => revoked.push(value),
  });

  registry.add("image-a");
  registry.add("image-b");
  registry.clear();

  assert.deepEqual(revoked, ["blob:image-a", "blob:image-b"]);
});
