import type {
  MountPlatformControls,
  MountShell,
} from "@fungi.computer/nacre/shell-module";

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
 * Standalone Oyster Settings chrome, loaded as its own lazy chunk.
 * App Permissions frame the host's page instead of importing host code;
 * other sections retain their existing host-backed ports.
 */
export const mountPlatformControls: MountPlatformControls = async (
  root,
  input,
) => {
  const settings = await import("./oyster-platform-controls.js");
  return settings.mountPlatformControls(root, input);
};
