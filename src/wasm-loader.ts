// Slim entry points + base64-inlined wasm so the bundle works under file://
// (no separate .wasm fetch). Mirrors the SW init in
// patchwork-next/core/bootloader/src/service-worker.ts (lines 116-122),
// but uses the base64 variant and runs in the page.

import { initializeBase64Wasm } from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { initSync as initSubductionSync } from "@automerge/automerge-subduction/slim";
// @ts-expect-error: "/wasm-base64" doesn't ship .d.ts
import { wasmBase64 as subductionWasmBase64 } from "@automerge/automerge-subduction/wasm-base64";

let booted: Promise<void> | null = null;

export function ensureWasm(): Promise<void> {
  if (booted) return booted;
  booted = (async () => {
    await initializeBase64Wasm(automergeWasmBase64 as string);
    // wasm-bindgen's new initSync signature is `({ module })`; passing the
    // bytes positionally still works but warns. Wrap in an object.
    initSubductionSync({ module: base64ToBytes(subductionWasmBase64 as string) });
  })();
  return booted;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
