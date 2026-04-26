export type ComponentManifest = {
  name: string;
  url: string;
};

/**
 * A component's default export. Returns either nothing or a cleanup fn.
 *
 * The mount fn is `async` so authors can `await repo.find(...)`, dynamic
 * imports, etc. before they touch the element. The registry handles races
 * (element removed mid-mount, source hot-reloaded mid-mount) by tracking a
 * generation per `Component` and running any returned cleanup immediately
 * if the mount lost its race.
 */
export type MountFn = (
  element: HTMLElement,
) => Promise<(() => void) | void> | ((() => void) | void);
