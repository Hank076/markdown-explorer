import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentRecord, extractHeadingMatches, searchDocumentIndex } from "../../app/workspace/document-index.js";

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

test("extractHeadingMatches ignores fenced code headings", () => {
  const headings = extractHeadingMatches(`
\`\`\`md
# not-a-heading
\`\`\`

# Real Heading
`);

  assert.deepEqual(headings, [{ level: 1, text: "Real Heading" }]);
});

test("buildDocumentRecord includes setext headings with stable ids", () => {
  const record = buildDocumentRecord({
    path: "guide/setext.md",
    content: `Title
=====

Subtitle
--------

Paragraph
`,
  });

  assert.deepEqual(
    record.headings.map(({ level, text, id }) => ({ level, text, id })),
    [
      { level: 1, text: "Title", id: "title" },
      { level: 2, text: "Subtitle", id: "subtitle" },
    ]
  );
});
