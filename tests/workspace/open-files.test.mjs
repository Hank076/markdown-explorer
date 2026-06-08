import test from "node:test";
import assert from "node:assert/strict";
import { reloadOpenFileContent } from "../../app/workspace/open-files.js";

test("reloadOpenFileContent reads latest content and clears rendered cache", async () => {
  const openFiles = new Map([
    [
      "notes.md",
      {
        name: "notes.md",
        content: "# Old",
        renderedHtml: "<h1>Old</h1>",
        handle: {
          async getFile() {
            return {
              async text() {
                return "# New";
              },
            };
          },
        },
      },
    ],
  ]);

  const result = await reloadOpenFileContent(openFiles, "notes.md");

  assert.equal(result.ok, true);
  assert.equal(openFiles.get("notes.md").content, "# New");
  assert.equal(openFiles.get("notes.md").renderedHtml, null);
});

test("reloadOpenFileContent rejects temporary files without handles", async () => {
  const openFiles = new Map([
    ["pasted/1.md", { name: "Pasted.md", content: "# Pasted", renderedHtml: null, handle: null }],
  ]);

  const result = await reloadOpenFileContent(openFiles, "pasted/1.md");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-refreshable");
  assert.equal(openFiles.get("pasted/1.md").content, "# Pasted");
});
