export async function loadPluginExport<T = unknown>(
  pluginUrl: string,
  relativePath: string
): Promise<T> {
  const assetUrl = resolvePluginAssetUrl(pluginUrl, relativePath);
  const module = await import(`/${encodeURIComponent(assetUrl)}`).catch(() => {
    throw new Error(`failed to load plugin asset: ${assetUrl}`);
  });
  return module.default as T;
}

export function resolvePluginAssetUrl(
  pluginUrl: string,
  relativePath: string
): string {
  if (!pluginUrl.startsWith("automerge:")) {
    throw new Error(`expected automerge: plugin url, got ${pluginUrl}`);
  }
  const [docId, ...rest] = pluginUrl.slice("automerge:".length).split("/");
  const segments = rest.slice(0, -1);
  for (const part of relativePath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return `automerge:${docId}/${segments.join("/")}`;
}
