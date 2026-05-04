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
    __overlock: {
      externals: Record<string, object>;
    };
    patchwork: {
      registerView: (manifestUrl: string) => Promise<void>;
    };
  }
}

export {};
