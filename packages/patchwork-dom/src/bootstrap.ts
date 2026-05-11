import type { Repo } from "@automerge/automerge-repo";

import { ComponentRegistry } from "./component-registry";

declare global {
  interface HTMLElementTagNameMap {
    "repo-provider": HTMLElement & { value: Repo };
    "view-registry-provider": HTMLElement & { value: ComponentRegistry };
  }
}

export async function bootstrap(
  root: HTMLElement,
  repo: Repo
): Promise<ComponentRegistry> {
  const src = root.getAttribute("src");
  if (!src) {
    throw new Error("bootstrap: root element is missing src attribute");
  }

  const repoProvider = document.createElement("repo-provider");
  repoProvider.style.display = "contents";
  repoProvider.value = repo;

  const registryHost = document.createElement("view-registry-provider");
  registryHost.style.display = "contents";
  repoProvider.appendChild(registryHost);

  const registry = new ComponentRegistry({ root: registryHost });
  registryHost.value = registry;

  root.appendChild(repoProvider);

  const name = await registry.register(src);
  const rootComponent = document.createElement(name);
  rootComponent.style.display = "contents";
  registryHost.appendChild(rootComponent);

  return registry;
}
