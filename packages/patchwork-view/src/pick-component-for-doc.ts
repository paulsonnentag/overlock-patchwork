import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  findHandle,
  getComponentRegistry,
  StateHandle,
  type ElementWithDocHandle,
} from "patchwork-dom";
import {
  hasPluginsProvider,
  loadPluginExport,
  type PluginManifest,
  type Plugins,
} from "patchwork-plugins";

export function pickComponentForDoc(
  element: ElementWithDocHandle,
  signal: AbortSignal
): StateHandle<string | undefined> {
  const handle = new StateHandle<string | undefined>(undefined);
  if (signal.aborted) return handle;

  const provider = findHandle(element, hasPluginsProvider);
  const docHandle = element.handle;
  if (!provider || !docHandle) return handle;

  const componentRegistry = getComponentRegistry(element);
  const schemaCache = new Map<string, Promise<StandardSchemaV1 | undefined>>();
  let runId = 0;

  const recompute = async () => {
    const myRun = ++runId;
    const alive = () => myRun === runId && !signal.aborted;
    const doc = docHandle.doc();
    if (doc === undefined) {
      handle.change(undefined);
      return;
    }
    const match = await pickMatchingPlugin(
      doc,
      provider.value,
      schemaCache,
      alive
    );
    if (!alive()) return;
    if (!match) {
      handle.change(undefined);
      return;
    }
    const tag = await componentRegistry
      .register(match.pluginUrl)
      .catch(() => undefined);
    if (!alive()) return;
    handle.change(tag);
  };

  const onChange = () => void recompute();
  provider.addEventListener("change", onChange, { signal });
  docHandle.on("change", onChange);
  signal.addEventListener("abort", () => {
    runId++;
    docHandle.off("change", onChange);
  });

  void recompute();
  return handle;
}

type PluginMatch = { pluginUrl: string; manifest: PluginManifest };

async function pickMatchingPlugin(
  doc: unknown,
  plugins: Plugins,
  cache: Map<string, Promise<StandardSchemaV1 | undefined>>,
  alive: () => boolean
): Promise<PluginMatch | undefined> {
  for (const [pluginUrl, manifest] of Object.entries(plugins.plugins)) {
    const schemaPath = (manifest as PluginManifest & { schema?: unknown })
      .schema;
    if (typeof schemaPath !== "string") continue;
    const schema = await loadSchema(pluginUrl, schemaPath, cache);
    if (!alive()) return undefined;
    if (!schema) continue;
    const result = await schema["~standard"].validate(doc);
    if (!alive()) return undefined;
    if (result.issues == null) return { pluginUrl, manifest };
  }
  return undefined;
}

function loadSchema(
  pluginUrl: string,
  schemaPath: string,
  cache: Map<string, Promise<StandardSchemaV1 | undefined>>
): Promise<StandardSchemaV1 | undefined> {
  const key = `${pluginUrl}::${schemaPath}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = loadPluginExport<StandardSchemaV1>(pluginUrl, schemaPath).catch(
      () => undefined
    );
    cache.set(key, pending);
  }
  return pending;
}
