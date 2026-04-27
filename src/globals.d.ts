import type { BranchableRepo } from "./branchable-repo";
import type { ComponentRegistry } from "./components";

declare global {
  interface Window {
    repo: BranchableRepo;
    isPatchworkReady: Promise<void>;
    automergeImport: (spec: string) => Promise<unknown>;
    createComponentRegistry: (root: HTMLElement) => ComponentRegistry;
  }
}

export {};
