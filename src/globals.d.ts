import type { BranchableRepo } from "./branchable-repo";
import type { ComponentRegistry } from "./components";
import type {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo/slim";

declare global {
  interface Window {
    repo: BranchableRepo;
    isPatchworkReady: Promise<void>;
    automergeImport: (spec: string) => Promise<unknown>;
    createComponentRegistry: (root: HTMLElement) => ComponentRegistry;
    AutomergeRepo: {
      isValidAutomergeUrl: typeof isValidAutomergeUrl;
      parseAutomergeUrl: typeof parseAutomergeUrl;
      stringifyAutomergeUrl: typeof stringifyAutomergeUrl;
    };
  }
}

export {};
