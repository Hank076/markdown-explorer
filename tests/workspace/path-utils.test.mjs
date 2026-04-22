import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspacePath, splitDocumentLink } from "../../app/workspace/path-utils.js";

test("resolveWorkspacePath normalizes nested relative paths", () => {
  assert.equal(
    resolveWorkspacePath("guide/setup/intro.md", "../assets/diagram.png"),
    "guide/assets/diagram.png",
  );
});

test("resolveWorkspacePath keeps root-safe absolute-like workspace paths", () => {
  assert.equal(resolveWorkspacePath("guide/setup/intro.md", "/README.md"), "README.md");
});

test("splitDocumentLink separates path and hash", () => {
  assert.deepEqual(splitDocumentLink("./guide.md#install"), {
    path: "./guide.md",
    hash: "install",
  });
});
