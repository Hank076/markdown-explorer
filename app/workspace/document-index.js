import { buildHeadingRecords } from "./headings.js";

function stripMarkdown(markdown = "") {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankPath(path = "", query = "") {
  const lowerPath = path.toLowerCase();
  const matchIndex = lowerPath.indexOf(query);
  return {
    matchIndex: matchIndex >= 0 ? matchIndex : Number.POSITIVE_INFINITY,
    length: path.length,
  };
}

export function buildDocumentRecord({ path, content }) {
  const headingMatches = [...content.matchAll(/^(#{1,4})\s+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    text: match[2].trim(),
  }));
  const headings = buildHeadingRecords(headingMatches);

  return {
    path,
    name: path.split("/").at(-1),
    content,
    plainText: stripMarkdown(content),
    headings,
  };
}

export function searchDocumentIndex(records, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return { files: [], headings: [], content: [] };
  }

  const files = [];
  const headings = [];
  const content = [];

  for (const record of records) {
    const lowerPath = record.path.toLowerCase();
    if (lowerPath.includes(query)) {
      files.push(record);
    }

    for (const heading of record.headings) {
      if (heading.text.toLowerCase().includes(query)) {
        headings.push({ path: record.path, heading });
      }
    }

    const lowerText = record.plainText.toLowerCase();
    const matchIndex = lowerText.indexOf(query);
    if (matchIndex >= 0) {
      const excerptStart = Math.max(matchIndex - 30, 0);
      content.push({
        path: record.path,
        excerpt: record.plainText.slice(excerptStart, excerptStart + 120),
        matchIndex,
      });
    }
  }

  files.sort((a, b) => {
    const rankA = rankPath(a.path, query);
    const rankB = rankPath(b.path, query);
    return rankA.matchIndex - rankB.matchIndex || rankA.length - rankB.length || a.path.localeCompare(b.path, "zh-Hant");
  });

  headings.sort((a, b) => {
    const rankA = rankPath(a.path, query);
    const rankB = rankPath(b.path, query);
    return rankA.matchIndex - rankB.matchIndex || rankA.length - rankB.length || a.path.localeCompare(b.path, "zh-Hant") || a.heading.id.localeCompare(b.heading.id, "zh-Hant");
  });

  content.sort((a, b) => {
    const rankA = rankPath(a.path, query);
    const rankB = rankPath(b.path, query);
    return rankA.matchIndex - rankB.matchIndex || rankA.length - rankB.length || a.path.localeCompare(b.path, "zh-Hant") || a.matchIndex - b.matchIndex;
  });

  return { files, headings, content };
}
