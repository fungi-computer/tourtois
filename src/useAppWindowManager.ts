import { useEffect, useMemo, useRef } from "react";
import type {
  TourtoisAppMountEvents,
  TourtoisAppSurfaceHost,
} from "./app-surface.js";
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
        mount: async (container, launch, signal, projectionEvents) => {
          if (!host) throw new Error("App host unavailable");
          return await host.mount(container, launch, signal, {
            onAgentSessionSelection: (selection) => {
              if (!host.reportAgentSessionSelection)
                return Promise.reject(
                  new Error("Hub Agent browser host unavailable"),
                );
              return Promise.resolve(
                host.reportAgentSessionSelection(
                  teamId,
                  launch.windowId,
                  selection,
                ),
              ).then(() => undefined);
            },
            onNavigation: (input) => latest.current.onNavigation(input),
            onAppOpen: (input) => latest.current.onAppOpen(input),
            onAppRole: (role) => latest.current.onAppRole(role),
            onSelectionChanged: () => latest.current.onSelectionChanged(launch),
            onFocus: () => {
              latest.current.onAppFocus(launch);
            },
            onNavigationState: projectionEvents.onNavigationState,
            onStatusItems: projectionEvents.onStatusItems,
            onComputerChoice: projectionEvents.onComputerChoice,
          });
        },
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
