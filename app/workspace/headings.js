export function slugifyHeading(text = "") {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function buildHeadingRecords(items = []) {
  const seen = new Map();

  return items.map((item) => {
    const baseId = slugifyHeading(item.text) || "section";
    const nextCount = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, nextCount);
    return {
      ...item,
      id: nextCount === 1 ? baseId : `${baseId}-${nextCount}`,
    };
  });
}
