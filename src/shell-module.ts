import type {
  MountPlatformControls,
  MountShell,
} from "@fungi.computer/oyster/shell/shell-module";

/**
 * This Release's shell module, emitted as `shell.js` beside `index.html`.
 * A host imports it from its own origin after first paint; Tourtois's code
 * and styles then load as one lazy chunk under the module's own URL.
 */
export const mountShell: MountShell = async (root, input) => {
  const shell = await import("./shell-release.js");
  return shell.mountShell(root, input);
};

/**
 * Tourtois's own Settings for a host that has none, such as a standalone
 * Oyster; they load as their own lazy chunk under this module's URL.
 */
export const mountPlatformControls: MountPlatformControls = async (
  root,
  input,
) => {
  const settings = await import("./oyster-platform-controls.js");
  return settings.mountPlatformControls(root, input);
};
