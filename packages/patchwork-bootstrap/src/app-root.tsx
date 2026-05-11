import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";

import type { DocHandle } from "@automerge/automerge-repo";

import { registerComponent, useHandle } from "patchwork-solid";

import "./styles.css";

import type { AccountDoc } from "./types";
import { hasAccountHandle } from "./types";

const BOOTSTRAP_PKG = "automerge:jdzc7uxAMQzWx5v2MBSZjzvBnMA";
const PLUGINS_PROVIDER_PKG = "automerge:29zNxHF4HDm5fk62Yb2ECnKP4Kxi";

const ACCOUNT_PROVIDER_URL = `${BOOTSTRAP_PKG}/dist/account-provider-component.json`;
const PLUGINS_PROVIDER_URL = `${PLUGINS_PROVIDER_PKG}/dist/plugins-provider-component.json`;

export default (element: HTMLElement) => {
  const AccountProvider = registerComponent(element, ACCOUNT_PROVIDER_URL);
  const PluginsProvider = registerComponent(element, PLUGINS_PROVIDER_URL);

  const [accountHandle, setAccountHandle] =
    createSignal<DocHandle<AccountDoc>>();

  const onAccountMounted = (el: HTMLElement) => {
    if (hasAccountHandle(el)) setAccountHandle(el.handle);
  };

  return render(
    () => (
      <AccountProvider onMounted={onAccountMounted}>
        <Show when={accountHandle()}>
          {(handle) => {
            const account = useHandle(handle());
            const Frame = registerComponent(element, account.frameUrl);
            return (
              <PluginsProvider url={account.packagesFolderUrl}>
                <Frame url={account.rootFolderUrl} />
              </PluginsProvider>
            );
          }}
        </Show>
      </AccountProvider>
    ),
    element
  );
};
