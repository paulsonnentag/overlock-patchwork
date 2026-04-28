import type { BranchableRepo } from "./branchable-repo";
import type {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo/slim";

declare global {
  interface Window {
    repo: BranchableRepo;
    AutomergeRepo: {
      isValidAutomergeUrl: typeof isValidAutomergeUrl;
      parseAutomergeUrl: typeof parseAutomergeUrl;
      stringifyAutomergeUrl: typeof stringifyAutomergeUrl;
    };
  }
}

export {};
