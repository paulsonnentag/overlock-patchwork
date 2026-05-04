export type PatchworkManifestsOptions = {
  include?: RegExp;
};

export type PatchworkManifestsPlugin = {
  name: string;
  enforce?: "pre" | "post";
};

export function patchworkManifests(
  options?: PatchworkManifestsOptions,
): PatchworkManifestsPlugin;
