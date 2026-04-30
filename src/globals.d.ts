import type {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo/slim";

declare global {
  interface Window {
    AutomergeRepo: {
      isValidAutomergeUrl: typeof isValidAutomergeUrl;
      parseAutomergeUrl: typeof parseAutomergeUrl;
      stringifyAutomergeUrl: typeof stringifyAutomergeUrl;
    };
    /**
     * Shared-instance dependencies for loaded packages. Populated by
     * the host bundle in `main.ts`; read by the shim modules the
     * loader generates from the `externals` constructor option (see
     * `Loader` in `src/loader.ts`).
     */
    __overlock: {
      externals: Record<string, object>;
    };
  }
}

export {};
