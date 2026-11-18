import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  TourtoisAppMountEvents,
  TourtoisAppSurfaceHost,
} from "./app-surface.js";
import { showAppToast } from "./app-toast.js";
import {
  createAppWindowManager,
  type AppLaunchDescriptor,
} from "./app-windows.js";

export type WindowEvents = Required<
  Pick<TourtoisAppMountEvents, "onNavigation" | "onAppOpen" | "onAppRole">
> & {
  onSelectionChanged: (launch: AppLaunchDescriptor) => Promise<boolean>;
  /** The App's own document took focus; raise its window. */
  onAppFocus: (launch: AppLaunchDescriptor) => void;
};

type MountEvents = Pick<
  TourtoisAppMountEvents,
  | "onDeliveryPending"
  | "onNavigationState"
  | "onStatusItems"
  | "onComputerChoice"
>;

/** One App frame mounted through the host, with the shell's shared event routing. */
function mountWithShellEvents(
  host: TourtoisAppSurfaceHost | null,
  teamId: string,
  latest: { readonly current: WindowEvents },
  container: Parameters<TourtoisAppSurfaceHost["mount"]>[0],
  launch: AppLaunchDescriptor,
  signal: AbortSignal,
  projectionEvents: MountEvents,
) {
  if (!host) throw new Error("App host unavailable");
  return host.mount(container, launch, signal, {
    ...(projectionEvents.onDeliveryPending && {
      onDeliveryPending: projectionEvents.onDeliveryPending,
    }),
    onAgentSessionSelection: (selection) => {
      if (!host.reportAgentSessionSelection)
        return Promise.reject(new Error("Hub Agent browser host unavailable"));
      return Promise.resolve(
        host.reportAgentSessionSelection(teamId, launch.windowId, selection),
      ).then(() => undefined);
    },
    onNavigation: (input) => latest.current.onNavigation(input),
    onAppOpen: (input) => latest.current.onAppOpen(input),
    onAppRole: (role) => latest.current.onAppRole(role),
    onSelectionChanged: () => latest.current.onSelectionChanged(launch),
    onFocus: () => {
      latest.current.onAppFocus(launch);
    },
    ...(projectionEvents.onNavigationState && {
      onNavigationState: projectionEvents.onNavigationState,
    }),
    ...(projectionEvents.onStatusItems && {
      onStatusItems: projectionEvents.onStatusItems,
    }),
    onToast: showAppToast,
    ...(projectionEvents.onComputerChoice && {
      onComputerChoice: projectionEvents.onComputerChoice,
    }),
  });
}

/**
 * Mount an App frame into a desktop tile through the same host mount the
 * windows use. A tile has no window chrome, so it takes no status or
 * navigation readouts. The returned function is stable per host and Team.
 */
export function useAppTileMount(
  host: TourtoisAppSurfaceHost | null,
  teamId: string,
  events: WindowEvents,
) {
  // A tile is not a window: it neither raises one nor replaces one when the
  // App's selection changes. The shell's command focus follows the frame itself.
  const latest = useRef(events);
  latest.current = {
    ...events,
    onAppFocus: () => undefined,
    onSelectionChanged: () => Promise.resolve(false),
  };
  return useCallback(
    async (
      container: Parameters<TourtoisAppSurfaceHost["mount"]>[0],
      launch: AppLaunchDescriptor,
      signal: AbortSignal,
    ) =>
      await mountWithShellEvents(
        host,
        teamId,
        latest,
        container,
        launch,
        signal,
        {},
      ),
    [host, teamId],
  );
}

/** One mounted host connection owns its windows, including StrictMode teardown. */
export function useAppWindowManager(
  host: TourtoisAppSurfaceHost | null,
  teamId: string,
  events: WindowEvents,
) {
  const latest = useRef(events);
  latest.current = events;
  const manager = useMemo(
    () =>
      createAppWindowManager({
        waitForAttachment: true,
        mount: async (container, launch, signal, projectionEvents) =>
          await mountWithShellEvents(
            host,
            teamId,
            latest,
            container,
            launch,
            signal,
            projectionEvents,
          ),
      }),
    [host, teamId],
  );
  const setups = useRef(
    new Map<ReturnType<typeof createAppWindowManager>, number>(),
  );
  useEffect(() => {
    setups.current.set(manager, (setups.current.get(manager) ?? 0) + 1);
    return () => {
      queueMicrotask(() => {
        const remaining = (setups.current.get(manager) ?? 1) - 1;
        if (remaining === 0) {
          setups.current.delete(manager);
          void manager.dispose();
        } else setups.current.set(manager, remaining);
      });
    };
  }, [manager]);
  return manager;
}
