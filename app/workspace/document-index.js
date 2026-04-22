import { marked } from "../../libs/marked/marked.esm.js";
import { buildHeadingRecords } from "./headings.js";

const headingTextRenderer = new marked.TextRenderer();
const namedHtmlEntities = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
]);

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

function stripInlineHtml(text = "") {
  return text.replace(/<[^>]*>/g, "");
}

function decodeHtmlEntities(text = "") {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const rawValue = isHex ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(rawValue, isHex ? 16 : 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    return namedHtmlEntities.get(entity) ?? match;
  });
}

function normalizeHeadingText(text = "") {
  return decodeHtmlEntities(stripInlineHtml(text)).trim();
}

function collectHeadingTokens(tokens, output = []) {
  if (!Array.isArray(tokens)) {
    return output;
  }

  for (const token of tokens) {
    if (!token || typeof token !== "object") {
      continue;
    }

    if (token.type === "heading" && typeof token.depth === "number" && token.depth >= 1 && token.depth <= 4) {
      const renderedText = marked.Parser.parseInline(token.tokens || [], { renderer: headingTextRenderer }).trim();
      output.push({
        level: token.depth,
        text: normalizeHeadingText(renderedText),
      });
    }

    for (const value of Object.values(token)) {
      if (Array.isArray(value)) {
        collectHeadingTokens(value, output);
      }
    }
  }

  return output;
}

export function extractHeadingMatches(content = "") {
  const tokens = marked.lexer(content);
  return collectHeadingTokens(tokens);
}

export function buildDocumentRecord({ path, content }) {
  const headingMatches = extractHeadingMatches(content);
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
