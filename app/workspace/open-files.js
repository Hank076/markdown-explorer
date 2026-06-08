export async function reloadOpenFileContent(openFiles, path) {
  const openFile = openFiles.get(path);
  if (!openFile?.handle) {
    return { ok: false, reason: "not-refreshable" };
  }

  const file = await openFile.handle.getFile();
  const content = await file.text();
  openFile.content = content;
  openFile.renderedHtml = null;
  openFiles.set(path, openFile);

  return { ok: true, content };
}
