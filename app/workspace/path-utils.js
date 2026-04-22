export function splitDocumentLink(href = "") {
  const [path = "", hash = ""] = href.split("#");
  return { path, hash };
}

export function resolveWorkspacePath(basePath = "", targetPath = "") {
  const normalizedTarget = targetPath.replace(/\\/g, "/");
  const baseDir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/") + 1) : "";
  const seed = normalizedTarget.startsWith("/") ? normalizedTarget.slice(1) : `${baseDir}${normalizedTarget}`;
  const parts = seed.split("/");
  const resolved = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return resolved.join("/");
}
