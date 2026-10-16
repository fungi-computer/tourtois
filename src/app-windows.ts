import type { AppOpenRequest } from "@fungi.computer/agar";
import {
  createWindowManager,
  hasVisibleWindows,
  type WindowHost,
  type WindowEvents,
  type WindowProjection,
  type WindowMount,
  type WindowManager,
  type WindowManagerOptions,
} from "@fungi.computer/oyster/shell/window-manager";

export type AppLaunchDescriptor = Readonly<{
  windowId: string;
  /** Stable presentation identity across default inheritance/customization. */
  surfaceId: string;
  installationId: string | null;
  appId: string;
  releaseId: string;
  title: string;
  href: string;
  openRequest: AppOpenRequest | null;
  /** Roles the App's Release declares; the shell's mark follows them. */
  roles: readonly string[];
  /** Digest-covered command declarations shown before the App is opened. */
  commands: readonly import("@fungi.computer/puffball/app").AppDeclaredCommand[];
  /**
   * The granted Computers this window's status bar offers the person.
   * Absent for an App that attaches to no Computer, or while the Team's
   * Computers cannot be read.
   */
  computers?: readonly Readonly<{ computerId: string; name: string }>[];
}>;

export type AppWindowHost = WindowHost<AppLaunchDescriptor>;
export type AppWindowEvents = WindowEvents;
export type AppWindowProjection = WindowProjection<
  AppLaunchDescriptor,
  HTMLElement
>;
export type AppWindowMount = WindowMount<AppLaunchDescriptor, HTMLElement>;
export type AppWindowManager = WindowManager<AppLaunchDescriptor, HTMLElement>;
export type AppWindowManagerOptions = Pick<
  WindowManagerOptions<AppLaunchDescriptor, HTMLElement>,
  "mount" | "waitForAttachment"
> &
  Readonly<{
    createContainer?: (launch: AppLaunchDescriptor) => HTMLElement;
  }>;
export const hasVisibleAppWindows = hasVisibleWindows<
  AppLaunchDescriptor,
  HTMLElement
>;

/** DOM attachment and App identity belong to the browser host. */
export function createAppWindowManager(
  options: AppWindowManagerOptions,
): AppWindowManager {
  return createWindowManager({
    ...options,
    createContainer:
      options.createContainer ?? (() => document.createElement("div")),
    isAttached: (container) => container.isConnected,
    // The offered Computers are the shell's status bar alone; the App never
    // receives them, so a new offer re-admits nothing.
    isChromeOnlyChange: (current, next) =>
      JSON.stringify(current.computers) !== JSON.stringify(next.computers) &&
      JSON.stringify({ ...current, computers: null }) ===
        JSON.stringify({ ...next, computers: null }),
    validateReconfiguration: (current, next) => {
      if (
        next.appId !== current.appId ||
        next.surfaceId !== current.surfaceId ||
        next.releaseId !== current.releaseId
      )
        throw new Error(
          "App identity cannot change during window reconfiguration",
        );
    },
  });
}
