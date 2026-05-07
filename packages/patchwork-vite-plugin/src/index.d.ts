export type PatchworkPluginConfig = {
  [contributionKind: string]: string[];
};

export type PatchworkPlugin = {
  name: string;
  enforce?: "pre" | "post";
};

export function patchwork(config?: PatchworkPluginConfig): PatchworkPlugin;
