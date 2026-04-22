import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentRecord, searchDocumentIndex } from "../../app/workspace/document-index.js";

test("buildDocumentRecord extracts headings and plain text", () => {
  const record = buildDocumentRecord({
    path: "guide/install.md",
    content: "# Install\n\nUse `npm start`.\n",
  });

  assert.equal(record.headings[0].id, "install");
  assert.match(record.plainText, /npm start/);
});

test("searchDocumentIndex groups file, heading, and content matches", () => {
  const index = [
    buildDocumentRecord({ path: "README.md", content: "# Overview\n\nIntro" }),
    buildDocumentRecord({ path: "guide/install.md", content: "# Install\n\nRun npm start" }),
  ];

  const result = searchDocumentIndex(index, "install");

  assert.equal(result.files[0].path, "guide/install.md");
  assert.equal(result.headings[0].heading.id, "install");
  assert.equal(result.content[0].path, "guide/install.md");
});

test("searchDocumentIndex returns empty groups for blank queries", () => {
  const index = [buildDocumentRecord({ path: "README.md", content: "# Overview\n\nIntro" })];

  const result = searchDocumentIndex(index, "   ");

  assert.deepEqual(result, { files: [], headings: [], content: [] });
});
