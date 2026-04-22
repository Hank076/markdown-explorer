export function slugifyHeading(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\s-]/g, "")
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
