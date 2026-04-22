import { resolveWorkspacePath } from "./path-utils.js";

export function isWorkspaceRelativeHref(href = "") {
  return Boolean(href) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href);
}

export function createAssetUrlRegistry({
  createObjectURL = URL.createObjectURL.bind(URL),
  revokeObjectURL = URL.revokeObjectURL.bind(URL),
} = {}) {
  const urls = new Set();

  return {
    add(blob) {
      const url = createObjectURL(blob);
      urls.add(url);
      return url;
    },
    clear() {
      for (const url of urls) {
        revokeObjectURL(url);
      }
      urls.clear();
    },
  };
}

export async function resolveAssetUrl({ href, activePath, rootHandle, registry }) {
  const path = resolveWorkspacePath(activePath, href);
  const parts = path.split("/").filter(Boolean);
  let dirHandle = rootHandle;

  for (let i = 0; i < parts.length - 1; i += 1) {
    dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
  }

  const fileHandle = await dirHandle.getFileHandle(parts.at(-1));
  const file = await fileHandle.getFile();

  return {
    path,
    file,
    url: registry.add(file),
  };
}
