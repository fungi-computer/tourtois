import { useLayer } from "@fungi.computer/maosaico";
import { AppMenus } from "./app-menus.js";
import { useAppSurfaceHost } from "./app-surface.js";

/** Render the focused App's commands with the shared shell renderer. */
export function FocusedAppMenus(): React.JSX.Element | null {
  const container = useLayer("popover");
  const host = useAppSurfaceHost();
  return <AppMenus host={host} container={container} />;
}
