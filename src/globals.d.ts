import type { Repo } from "@automerge/automerge-repo/slim";

declare global {
  interface Window {
    repo: Repo;
    isPatchworkReady: Promise<void>;
    automergeImport: (spec: string) => Promise<unknown>;
  }
}

export {};
