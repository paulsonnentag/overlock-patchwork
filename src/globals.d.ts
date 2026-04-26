import type { Repo } from "@automerge/automerge-repo/slim";
import type { ComponentRegistry } from "./components";

declare global {
  interface Window {
    repo: Repo;
    isPatchworkReady: Promise<void>;
    automergeImport: (spec: string) => Promise<unknown>;
    createComponentRegistry: (root: HTMLElement) => ComponentRegistry;
  }
}

export {};
