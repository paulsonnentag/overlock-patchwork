import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { DocHandle } from "@automerge/automerge-repo";
import createDebug from "debug";

import {
  findHandle,
  getComponentRegistry,
  StateHandle,
} from "patchwork-dom";
import {
  hasPluginsProvider,
  loadPluginExport,
  type PluginManifest,
  type Plugins,
} from "patchwork-plugins";

const log = createDebug("patchwork:view");

export function findCompatibleComponent(
  element: HTMLElement,
  handle: DocHandle<unknown>,
): StateHandle<string | undefined> {
  const tagHandle = new StateHandle<string | undefined>(undefined);

  const provider = findHandle(element, hasPluginsProvider);
  if (!provider) return tagHandle;

  const componentRegistry = getComponentRegistry(element);
  const schemaCache = new Map<string, Promise<StandardSchemaV1 | undefined>>();

  let disposed = false;
  let running = false;
  let dirty = false;

  const recompute = async () => {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        const doc = handle.doc();
        if (disposed) return;
        if (doc === undefined) {
          log("doc undefined for %s", handle.url);
          tagHandle.change(undefined);
          continue;
        }
        log("matching %s %o", handle.url, doc);
        const match = await pickMatchingPlugin(
          doc,
          provider.value,
          schemaCache,
          () => !disposed,
        );
        if (disposed) return;
        if (!match) {
          log("no plugin matched %s", handle.url);
          tagHandle.change(undefined);
          continue;
        }
        log("matched plugin %s", match.pluginUrl);
        log("register start %s", match.pluginUrl);
        const tag = await componentRegistry
          .register(match.pluginUrl)
          .catch((err) => {
            log("register failed %s %o", match.pluginUrl, err);
            return undefined;
          });
        log("register resolved %s -> %s", match.pluginUrl, tag);
        if (disposed) {
          log("disposed after register %s", match.pluginUrl);
          return;
        }
        tagHandle.change(tag);
        log("tag set to %s for %s", tag, handle.url);
      } while (dirty && !disposed);
    } finally {
      running = false;
    }
  };

  const onChange = () => void recompute();

  const onUnmount = (event: Event) => {
    if (event.target !== element) return;
    disposed = true;
    handle.off("change", onChange);
    provider.removeEventListener("change", onChange);
    element.removeEventListener("patchwork:unmounted", onUnmount);
  };

  provider.addEventListener("change", onChange);
  handle.on("change", onChange);
  element.addEventListener("patchwork:unmounted", onUnmount);

  void recompute();
  return tagHandle;
}

type PluginMatch = { pluginUrl: string; manifest: PluginManifest };

async function pickMatchingPlugin(
  doc: unknown,
  plugins: Plugins,
  cache: Map<string, Promise<StandardSchemaV1 | undefined>>,
  alive: () => boolean,
): Promise<PluginMatch | undefined> {
  for (const [pluginUrl, manifest] of Object.entries(plugins.plugins)) {
    const schemaPath = (manifest as PluginManifest & { schema?: unknown })
      .schema;
    if (typeof schemaPath !== "string") {
      log("  skip %s (no schema)", pluginUrl);
      continue;
    }
    const schema = await loadSchema(pluginUrl, schemaPath, cache);
    if (!alive()) return undefined;
    if (!schema) {
      log("  skip %s (schema load failed: %s)", pluginUrl, schemaPath);
      continue;
    }
    const result = await schema["~standard"].validate(doc);
    if (!alive()) return undefined;
    if (result.issues == null) return { pluginUrl, manifest };
    log("  reject %s %s issues: %o", pluginUrl, schemaPath, result.issues);
  }
  return undefined;
}

function loadSchema(
  pluginUrl: string,
  schemaPath: string,
  cache: Map<string, Promise<StandardSchemaV1 | undefined>>,
): Promise<StandardSchemaV1 | undefined> {
  const key = `${pluginUrl}::${schemaPath}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = loadPluginExport<StandardSchemaV1>(pluginUrl, schemaPath).catch(
      () => undefined,
    );
    cache.set(key, pending);
  }
  return pending;
}
