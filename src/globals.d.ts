import type { BranchableRepo } from "./branchable-repo";

declare global {
  interface Window {
    repo: BranchableRepo;
  }
}

export {};
