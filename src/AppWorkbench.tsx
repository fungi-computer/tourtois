import type { DesktopMethods } from "./desktop-api.js";
import { desktopSettingsHandler } from "./desktop/consent.js";
import { AppError, type FileNavigationInput } from "@fungi.computer/agar";
import type { AppOpenInput } from "@fungi.computer/agar/apps";
import { type AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import { toast, Toaster } from "@fungi.computer/caps/components/toaster";
import { WindowSnapPreview } from "@fungi.computer/caps/components/window";
import {
  MaosaicoRegion,
  useLayer,
  useMaosaicoLayout,
} from "@fungi.computer/maosaico";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { addressKey } from "@fungi.computer/nacre/app-directory";
import {
  reconcileAppDirectory,
  reconcileAppWindowFromDirectory,
} from "./app-directory-reconciliation.js";
import type { WorkbenchDirectory } from "@fungi.computer/nacre/workbench-directory";
import { useAppDirectory } from "./app-directory.js";
import { AppIcon } from "./app-icon.js";
import {
  appForRole,
  composeOpenRequests,
  createAppLaunchDescriptor,
  attachWindowComputer,
  launchComputerId,
  launchForComputer,
  launchForRoleIntent,
  requireHandledNavigation,
  resolveFileEditorWindow,
  type AppDirectoryApp,
  type ComputerOption,
} from "./app-launch.js";
import {
  useAppSurfaceHost,
  type TourtoisAppSurfaceHost,
} from "./app-surface.js";
import {
  hasVisibleAppWindows,
  type AppLaunchDescriptor,
} from "./app-windows.js";
import { desktopVisibility } from "./desktop-visibility.js";
import { AppPane, FocusedWindowControls } from "./AppPane.js";
import { WorkbenchAppBar } from "./WorkbenchAppBar.js";
import { DesktopMenuBar } from "./DesktopMenuBar.js";
import type { PlatformControls } from "./platform-controls.js";
import type { AppStorage } from "@fungi.computer/agar/storage";
import type { DesktopGillTransport } from "./desktop/row-gill.js";
import type { SettingsLocation } from "./settings-routes.js";
import { ShellCommandDialogs, useShellCommands } from "./shell-commands.js";
import { OwnSprite } from "./member-avatar.js";
import { Desktop } from "./desktop/Desktop.js";
import type { DesktopLayoutClient } from "./desktop-client.js";
import { useAppOpenUrlHandoff } from "./useAppOpenUrlHandoff.js";
import { useAppWindowManager } from "./useAppWindowManager.js";

import { useDirectoryCommands } from "./useDirectoryCommands.js";

type AppDirectoryReconciliationFailure = {
  action: "close" | "replace" | null;
};

const emptyAppBarLabel = (loading: boolean, failed: boolean): string => {
  if (loading) return "Loading Apps…";
  if (failed) return "Apps unavailable";
  return "Apps will appear here when available.";
};

export type AppWorkbenchProps = Readonly<{
  teamId: string;
  teamName: string;
  initialComputerId: string | null;
  computers: readonly ComputerOption[];
  computersUnavailable: boolean;
  paneLayerRef: RefObject<HTMLDivElement>;
  phone: boolean;
  extraPanes?: (context: {
    activeId: string | null;
    order: readonly string[];
    focus: (id: string) => void;
  }) => ReactNode;
  initialFocusId?: string;
  onLayoutChange?: ((tiled: boolean) => void) | undefined;
  extraLaunchers?: readonly AppBarItem[];
  settingsLaunchers?: readonly Readonly<{
    id: string;
    label: string;
    icon?: ReactNode;
    location: SettingsLocation;
  }>[];
  systemMenuItems?: ReactNode;
  /** Read the Team's App directory through the host's `directory()` port. */
  directoryReader: () => Promise<WorkbenchDirectory>;
  /** Take the host address's App-open handoff once, instead of this URL's. */
  takeAppOpenRequest?: () => Promise<AppOpenInput | null>;
  /** Team administration, rendered by the host with the owner's authority. */
  platform: PlatformControls;
  desktopStorage: AppStorage;
  desktopMethods: DesktopMethods;
  gills: DesktopGillTransport;
}>;

/** Phone Home uses the same public shell command as the keyboard. */
function phoneShowDesktop(
  phone: boolean,
  covered: boolean,
  host: TourtoisAppSurfaceHost | null,
  onFailure: (message: string) => void,
): (() => void) | undefined {
  if (!phone || !covered || !host) return undefined;
  return () => {
    void host
      .execute("shell:desktop.show", { origin: "menu" })
      .then((outcome) => {
        if (outcome.status !== "handled") {
          console.error("Phone Show desktop refused", outcome);
          onFailure("The desktop could not be shown. Try again.");
        }
      })
      .catch((cause: unknown) => {
        console.error("Phone Show desktop failed", cause);
        onFailure("The desktop could not be shown. Try again.");
      });
  };
}

export function AppWorkbench({
  paneLayerRef,
  phone,
  teamId,
  teamName,
  initialComputerId,
  computers,
  computersUnavailable,
  extraPanes,
  initialFocusId,
  onLayoutChange,
  extraLaunchers = [],
  settingsLaunchers = [],
  systemMenuItems,
  directoryReader,
  takeAppOpenRequest,
  platform,
  desktopStorage,
  desktopMethods,
  gills,
}: AppWorkbenchProps) {
  const setSettingsLocation = platform.openSettings;
  const [appDialOpen, setAppDialOpen] = useState(false);
  // The Layout menu's "Arrange desktop" command and the desktop's own
  // controls share one state: this is their common ancestor.
  const [desktopEditing, setDesktopEditing] = useState(false);
  const appDialContainer = useLayer("popover");
  const noticeContainer = useLayer("toast");
  const layout = useMaosaicoLayout();
  const { activeId, focus, mode, order } = layout;
  const appSurfaceHost = useAppSurfaceHost();
  const selectionRefreshes = useRef(new Map<string, number>());
  const appWindows = useAppWindowManager(appSurfaceHost, teamId, {
    onNavigation: (input) => openNavigation(input),
    onAppOpen: (input) => openApp(input),
    onAppRole: (role) => {
      const chosen = appForRole(
        appsQuery.data?.apps ?? [],
        directoryRoles,
        role,
      );
      return Promise.resolve(
        chosen ? { displayName: chosen.displayName ?? null } : null,
      );
    },
    onSelectionChanged: (launch) => refreshAppDirectory(launch),
    // Raise only: the App already holds keyboard focus inside its frame.
    onAppFocus: (launch) => {
      focus(launch.windowId);
    },
  });
  const appProjection = useSyncExternalStore(
    appWindows.subscribe,
    appWindows.read,
    appWindows.read,
  );
  useEffect(() => {
    for (const window of appProjection.windows)
      if (window.status === "ready")
        selectionRefreshes.current.delete(window.windowId);
  }, [appProjection]);
  const [appStatus, setAppStatus] = useState<string | Error | null>(null);
  useEffect(() => {
    if (!appStatus) return;
    const disconnected =
      appStatus instanceof AppError && appStatus.code === "DISCONNECTED";
    let message =
      appStatus instanceof Error
        ? "This App couldn’t complete that request."
        : appStatus;
    if (disconnected) message = "This App lost its connection.";
    const notice = {
      id: "workbench-status",
      toasterId: "workbench-notices",
      closeButton: true,
      dismissible: true,
    };
    if (disconnected) {
      toast(message, {
        ...notice,
        duration: Infinity,
        description: "Reload the workspace to reconnect.",
        action: {
          label: "Reload",
          onClick: () => {
            window.location.reload();
          },
        },
      });
    } else toast(message, notice);
  }, [appStatus]);
  const reconciledDirectoryRef = useRef<readonly AppDirectoryApp[] | null>(
    null,
  );
  const focusWindow = useCallback(
    (id: string) => {
      focus(id);
      requestAnimationFrame(() => {
        const pane = [
          ...(paneLayerRef.current?.querySelectorAll<HTMLElement>(
            "[data-window-id]",
          ) ?? []),
        ].find((candidate) => candidate.dataset.windowId === id);
        pane
          ?.querySelector<HTMLButtonElement>("[data-caps-window-handle]")
          ?.focus();
      });
    },
    [focus, paneLayerRef],
  );
  const afterHide = (id: string) => {
    if (layout.zoomedId === id) layout.zoom(null);
    const next = appWindows
      .read()
      .windows.filter(
        (item) => item.windowId !== id && item.status !== "minimized",
      )
      .at(-1);
    if (next) focusWindow(next.windowId);
    else
      requestAnimationFrame(() => {
        paneLayerRef.current
          ?.closest(".tourtois-workbench-layout")
          ?.querySelector<HTMLButtonElement>(".caps-app-bar-launcher-button")
          ?.focus();
      });
  };
  const activeWindow = appProjection.windows.find(
    (item) => item.windowId === activeId && item.status !== "minimized",
  );
  const activeSurfaceId = activeWindow?.launch.surfaceId ?? null;
  // The App owns its history; a refusal or failure leaves Back in place.
  const goBack = (windowId: string) => {
    void appWindows.back(windowId).catch((cause: unknown) => {
      console.error("App workbench operation failed", cause);
    });
  };
  // The shell's window keys run through Whistle so /keys, the `:` line and
  // which-key list them; these are the behaviors behind those commands.
  const stepTarget = (step: -1 | 1) =>
    order.length < 2
      ? undefined
      : order[
          (Math.max(0, order.indexOf(activeId ?? "")) + step + order.length) %
            order.length
        ];
  const desktopOwner = useRef<DesktopLayoutClient | null>(null);
  useEffect(() => {
    let retired = false;
    let registration:
      | Awaited<ReturnType<PlatformControls["registerDesktopSettings"]>>
      | undefined;
    const close = (value: typeof registration) => {
      if (value)
        void value.close().catch((cause: unknown) => {
          console.error("Desktop settings registration close failed", cause);
          return { kind: "failed", cause };
        });
    };
    void platform
      .registerDesktopSettings(
        desktopSettingsHandler(() => desktopOwner.current),
      )
      .then((value) => {
        if (retired) close(value);
        else registration = value;
      })
      .catch((cause: unknown) => {
        console.error("Desktop settings registration failed", cause);
        setAppStatus(
          "Desktop settings are unavailable. Reopen the desktop to try again.",
        );
        return { kind: "failed", cause };
      });
    return () => {
      retired = true;
      close(registration);
    };
  }, [platform]);

  const receiveDesktopOwner = useCallback(
    (owner: DesktopLayoutClient | null) => {
      desktopOwner.current = owner;
    },
    [],
  );
  const shellCommands = useShellCommands(appSurfaceHost, {
    openApp: () => {
      setAppDialOpen(true);
    },
    showDesktop: async () => {
      layout.zoom(null);
      if (hasVisibleAppWindows(appWindows.read())) {
        const hiding = appWindows.hideAll();
        afterHide("");
        await hiding;
      } else {
        await appWindows.restoreHidden();
        const restored = appWindows
          .read()
          .windows.find((item) => item.status !== "minimized");
        if (restored) focusWindow(restored.windowId);
      }
    },
    focusStep: (step) => {
      const next = stepTarget(step);
      if (!next) return;
      layout.zoom(null);
      focusWindow(next);
    },
    swapStep: (step) => {
      const next = stepTarget(step);
      if (next && activeId) layout.swap(activeId, next);
    },
    toggleZoom: () => {
      if (activeId) layout.zoom(layout.zoomedId === activeId ? null : activeId);
    },
    back: () => {
      if (activeId) goBack(activeId);
    },
  });
  useEffect(() => {
    appSurfaceHost?.focus?.(activeSurfaceId);
  }, [appSurfaceHost, activeSurfaceId, activeWindow?.status]);
  const {
    query: appsQuery,
    apps: listedApps,
    needsUpdate,
    roles: directoryRoles,
  } = useAppDirectory(teamId, directoryReader);
  const refetchApps = appsQuery.refetch;
  useEffect(
    () =>
      platform.subscribeChanges(() => {
        void refetchApps();
      }),
    [platform, refetchApps],
  );
  const launchFor = (
    installation: AppDirectoryApp,
    currentLaunch?: AppLaunchDescriptor,
  ) => {
    return createAppLaunchDescriptor(
      installation,
      currentLaunch
        ? launchComputerId(currentLaunch.href)
        : (appsQuery.data?.computer?.computerId ?? initialComputerId),
      window.location.origin,
      computers,
      computersUnavailable,
    );
  };
  const refreshAppDirectory = async (launch: AppLaunchDescriptor) => {
    const attempts = selectionRefreshes.current.get(launch.windowId) ?? 0;
    if (attempts >= 3) return false;
    selectionRefreshes.current.set(launch.windowId, attempts + 1);
    const refreshed = await appsQuery.refetch({ throwOnError: true });
    const apps = refreshed.data?.apps ?? [];
    reconciledDirectoryRef.current = apps;
    const failure: AppDirectoryReconciliationFailure = { action: null };
    const replaced = await reconcileAppWindowFromDirectory(
      appWindows,
      launch,
      apps,
      launchFor,
      { kind: "selection-changed" },
      (action) => {
        failure.action = action;
      },
    );
    if (!replaced && failure.action === null)
      setAppStatus(
        "The App selection changed. This window stayed open; close it after saving or discarding work, then reopen the App.",
      );
    else if (!replaced)
      setAppStatus(
        failure.action === "close"
          ? "App could not be closed."
          : "App could not be replaced.",
      );
    return replaced;
  };

  const openNavigation = async (input: FileNavigationInput): Promise<void> => {
    if (!appSurfaceHost)
      throw new Error("Open an editor App before opening this file.");
    const editor = await resolveFileEditorWindow({
      apps: listedApps ?? [],
      roles: directoryRoles,
      appWindows,
      appSurfaceHost,
      computerId: input.computerId,
      computers,
      origin: window.location.origin,
      onPermissionNeeded: (app) => {
        setSettingsLocation({
          category: "apps",
          appKey: addressKey(app.address),
          section: "permissions",
        });
      },
    });
    const { launch } = editor;
    const previousLaunch = launch;
    const nextLaunch = launchForComputer(launch, input.computerId);
    try {
      await appWindows.restore(launch.windowId);
      // File navigation carries the source Computer. Reconfigure Inkcap's
      // mounted host first so its open-file command receives the exact
      // target; the existing iframe and command contribution stay in place.
      await appWindows.reconfigure(launch.windowId, nextLaunch);
      const mounted = appWindows
        .read()
        .windows.find((window) => window.windowId === launch.windowId);
      if (mounted?.launch.href !== nextLaunch.href)
        throw new Error("The editor could not use the source Computer.");
      layout.zoom(null);
      focusWindow(launch.windowId);
      appSurfaceHost.focus?.(launch.surfaceId);

      const commandId = `${launch.surfaceId}:open-file`;
      const outcome = await appSurfaceHost.execute(commandId, {
        origin: "programmatic",
        arguments: input,
      });
      requireHandledNavigation(outcome);
    } catch (error) {
      if (
        appWindows
          .read()
          .windows.some(
            (window) =>
              window.windowId === launch.windowId &&
              window.launch.href === nextLaunch.href,
          )
      )
        await appWindows
          .reconfigure(launch.windowId, previousLaunch)
          .catch((cause: unknown) => {
            console.error("App workbench operation failed", cause);
            return undefined;
          });
      if (editor.opened)
        await appWindows.close(launch.windowId).catch((cause: unknown) => {
          console.error("App workbench operation failed", cause);
          return undefined;
        });
      throw error;
    }
  };

  const openAppPermissions = (surfaceId: string) => {
    const app = directory.find((item) => item.surfaceId === surfaceId);
    setSettingsLocation({
      category: "apps",
      appKey: app ? addressKey(app.address) : null,
      section: "permissions",
    });
  };
  /** The person chose another Computer in one window's status bar. */
  const selectWindowComputer = async (
    windowId: string,
    computerId: string,
  ): Promise<void> => {
    setAppStatus(null);
    try {
      await attachWindowComputer(appWindows, windowId, computerId);
    } catch (cause) {
      console.error("App workbench operation failed", cause);
      setAppStatus("Computer unavailable. Review this App's permissions.");
      const surfaceId = appWindows
        .read()
        .windows.find((item) => item.windowId === windowId)?.launch.surfaceId;
      if (surfaceId) openAppPermissions(surfaceId);
    }
  };

  const openApp = async (input: AppOpenInput) => {
    const current = await appsQuery.refetch({ throwOnError: true });
    const requested = launchForRoleIntent(
      current.data?.apps ?? [],
      directoryRoles,
      input,
      composeOpenRequests.request.generate(),
      (app) => launchFor(app),
    );
    const existing = appWindows
      .read()
      .windows.some((item) => item.windowId === requested.windowId);
    if (existing) {
      await appWindows.restore(requested.windowId);
      await appWindows.reconfigure(requested.windowId, requested);
    } else await appWindows.open(requested);
    layout.zoom(null);
    focusWindow(requested.windowId);
  };

  useAppOpenUrlHandoff({
    teamId,
    host: appSurfaceHost,
    ready: appsQuery.isSuccess,
    takeAppOpenRequest,
    onOpen: openApp,
    setError: setAppStatus,
  });
  useEffect(() => {
    if (initialFocusId) focus(initialFocusId);
  }, [focus, initialFocusId]);

  useEffect(() => {
    if (!listedApps) return;
    if (reconciledDirectoryRef.current === listedApps) {
      reconciledDirectoryRef.current = null;
      return;
    }
    void reconcileAppDirectory(appWindows, listedApps, launchFor, (action) => {
      setAppStatus(
        action === "close"
          ? "App could not be closed."
          : "App could not be replaced.",
      );
    });
  }, [appWindows, listedApps, initialComputerId, computers]);

  const directory = useMemo(() => listedApps ?? [], [listedApps]);
  const launchApp = (
    installation: AppDirectoryApp,
    requestedLaunch?: AppLaunchDescriptor,
  ) => {
    const windowId = "app:" + installation.surfaceId;
    const launch = requestedLaunch ?? launchFor(installation);
    if (!launch) {
      setAppStatus(
        installation.availability !== "available"
          ? `${installation.displayName ?? "App"} is unavailable.`
          : `${installation.displayName ?? "App"} has no available surface.`,
      );
      return;
    }
    setAppStatus(null);
    performance.mark("fungi.app-open.tourtois-launch-start");
    const existing = appWindows
      .read()
      .windows.find((item) => item.windowId === windowId);
    const opening =
      existing && launch.openRequest !== null
        ? appWindows
            .restore(windowId)
            .then(() => appWindows.reconfigure(windowId, launch))
        : appWindows.open(launch);
    void opening
      .then(() => {
        performance.mark("fungi.app-open.tourtois-launch-ready");
        layout.zoom(null);
        focusWindow(windowId);
      })
      .catch((cause: unknown) => {
        console.error("App workbench operation failed", cause);

        setAppStatus(
          `${installation.displayName ?? "App"} could not be opened.`,
        );
      });
  };
  useDirectoryCommands({
    host: appSurfaceHost,
    directory,
    manager: appWindows,
    launchFor,
    onFocus: (windowId) => {
      layout.zoom(null);
      focusWindow(windowId);
    },
    onError: setAppStatus,
  });
  // A dashboard App opens as the Team's workspace, never as a window in it.
  const windowApps = useMemo(
    () =>
      directory.filter(
        (installation) => !installation.roles.includes("dashboard"),
      ),
    [directory],
  );
  const launchableItems: AppBarItem[] = windowApps
    .filter((installation) => launchFor(installation) !== null)
    .map((installation) => {
      const windowId = "app:" + installation.surfaceId;
      return {
        id: windowId,
        label: installation.displayName ?? "App",
        icon: <AppIcon roles={installation.roles} icon={installation.icon} />,
        onSelect: () => {
          launchApp(installation);
        },
      };
    });
  const appLaunchers = launchableItems.filter(
    (launcher) =>
      !appProjection.windows.some((window) => window.windowId === launcher.id),
  );
  appLaunchers.push(
    ...settingsLaunchers.map((launcher) => {
      const item = {
        id: launcher.id,
        label: launcher.label,
        onSelect: () => {
          setSettingsLocation(launcher.location);
        },
      };
      return launcher.icon ? { ...item, icon: launcher.icon } : item;
    }),
    ...extraLaunchers,
  );
  const inboxSurfaceId = useMemo(
    () => appForRole(directory, directoryRoles, "inbox")?.surfaceId ?? null,
    [directory, directoryRoles],
  );
  const visibility = desktopVisibility({
    hasVisibleWindows:
      hasVisibleAppWindows(appProjection) ||
      order.some(
        (id) => !appProjection.windows.some((window) => window.windowId === id),
      ),
    mode,
    zoomedId: layout.zoomedId,
    phone,
  });
  const covered = visibility === "covered";
  const desktopRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (desktopRef.current) desktopRef.current.inert = covered;
  }, [covered]);
  return (
    <div className="tourtois-workbench-layout">
      <DesktopMenuBar
        onShowDesktop={phoneShowDesktop(
          phone,
          covered,
          appSurfaceHost,
          setAppStatus,
        )}
        teamName={teamName}
        appBar={
          <WorkbenchAppBar
            phone={phone}
            container={appDialContainer}
            isOpen={appDialOpen}
            launcherLabels="wrap"
            onOpenChange={setAppDialOpen}
            emptyLabel={emptyAppBarLabel(
              appsQuery.isLoading,
              appsQuery.isError,
            )}
            windows={appProjection.windows.map((projection) => ({
              id: projection.windowId,
              label: projection.launch.title,
              icon: (
                <AppIcon
                  roles={projection.launch.roles}
                  icon={
                    directory.find(
                      (app) => app.surfaceId === projection.launch.surfaceId,
                    )?.icon
                  }
                />
              ),
              active: activeId === projection.windowId,
              onSelect: () => {
                void appWindows
                  .restore(projection.windowId)
                  .then(() => {
                    layout.zoom(null);
                    focusWindow(projection.windowId);
                  })
                  .catch((cause: unknown) => {
                    console.error("App workbench operation failed", cause);

                    setAppStatus("App could not be restored.");
                  });
              },
              onClose: () => {
                void appWindows
                  .close(projection.windowId)
                  .then(() => {
                    if (
                      !appWindows
                        .read()
                        .windows.some(
                          (item) => item.windowId === projection.windowId,
                        )
                    )
                      afterHide(projection.windowId);
                  })
                  .catch((cause: unknown) => {
                    console.error("App workbench operation failed", cause);

                    setAppStatus("App could not be closed.");
                  });
              },
            }))}
            launchers={appLaunchers}
            launcher={{
              label: "Open Apps",
              icon: (
                <OwnSprite
                  aria-hidden="true"
                  style={{ width: "100%", height: "100%" }}
                />
              ),
            }}
          />
        }
        onOpenSettings={() => {
          setSettingsLocation({ category: "home" });
        }}
        onEditAvatar={() => {
          setSettingsLocation({ category: "avatar" });
        }}
        focusedId={activeWindow?.windowId ?? null}
        title={activeWindow?.launch.title ?? "Apps"}
        tiled={mode === "tiled"}
        onLayoutChange={
          onLayoutChange
            ? (tiled) => {
                layout.zoom(null);
                onLayoutChange(tiled);
              }
            : undefined
        }
        onRestoreLayout={
          layout.zoomedId
            ? () => {
                layout.zoom(null);
              }
            : undefined
        }
        onArrangeDesktop={() => {
          setDesktopEditing(true);
        }}
        focusedControls={
          activeWindow ? (
            <FocusedWindowControls
              key={activeWindow.windowId}
              projection={activeWindow}
              app={directory.find(
                (app) => app.surfaceId === activeWindow.launch.surfaceId,
              )}
              onOpenSettings={() => {
                const app = directory.find(
                  (item) => item.surfaceId === activeWindow.launch.surfaceId,
                );
                setSettingsLocation({
                  category: "apps",
                  appKey: app ? addressKey(app.address) : null,
                  section: "advanced",
                });
              }}
              onOpenPermissions={() => {
                openAppPermissions(activeWindow.launch.surfaceId);
              }}
            />
          ) : null
        }
        systemMenuItems={systemMenuItems}
      />
      {noticeContainer
        ? createPortal(
            <Toaster
              id="workbench-notices"
              position="bottom-right"
              offset={24}
              mobileOffset={24}
              closeButton
            />,
            noticeContainer,
          )
        : null}
      <div className="relative min-h-0 flex-1">
        <MaosaicoRegion
          layer="desktop"
          style={{ position: "absolute", inset: 0 }}
          data-desktop-visibility={visibility}
          ref={desktopRef}
          aria-hidden={covered ? true : undefined}
        >
          <Desktop
            phone={phone}
            editing={desktopEditing}
            onEditingChange={setDesktopEditing}
            inboxSurfaceId={inboxSurfaceId}
            onOwner={receiveDesktopOwner}
            launcherItems={launchableItems}
            onAllApps={() => {
              setAppDialOpen(true);
            }}
            paused={covered}
            apps={windowApps}
            needsUpdate={needsUpdate}
            onAppSettings={(app) => {
              setSettingsLocation({
                category: "apps",
                appKey: addressKey(app.address),
                section: "advanced",
              });
            }}
            loading={appsQuery.isLoading}
            unavailable={appsQuery.isError}
            onOpen={(input) => {
              void openApp(input).catch((cause: unknown) => {
                console.error("Gill destination could not be opened", cause);
                setAppStatus("The widget’s App could not be opened.");
              });
            }}
            computersForGill={(surfaceId) => {
              const app = windowApps.find((app) => app.surfaceId === surfaceId);
              return app ? (launchFor(app)?.computers ?? []) : [];
            }}
            storage={desktopStorage}
            methods={desktopMethods}
            transport={gills}
            onRetryApps={() => {
              void appsQuery.refetch();
            }}
          />
        </MaosaicoRegion>
        <MaosaicoRegion
          layer="windows"
          style={{ height: "100%", pointerEvents: "none" }}
          ref={paneLayerRef}
          className="tourtois-pane-layer"
          data-layout-mode={mode}
        >
          {appProjection.windows.map((projection, index) => {
            const app = directory.find(
              (item) => item.surfaceId === projection.launch.surfaceId,
            );
            return (
              <AppPane
                key={projection.windowId}
                index={index}
                focusWindow={focusWindow}
                afterHide={afterHide}
                onBack={goBack}
                manager={appWindows}
                projection={projection}
                nextLaunch={app ? launchFor(app, projection.launch) : null}
                icon={app?.icon}
                onError={setAppStatus}
                onSelectComputer={(windowId, computerId) => {
                  void selectWindowComputer(windowId, computerId);
                }}
              />
            );
          })}
          {extraPanes?.({ activeId, order, focus })}
          {layout.snapPreview && (
            <WindowSnapPreview
              data-snap-side={layout.snapPreview.side}
              style={{
                left: layout.snapPreview.frame.x,
                top: layout.snapPreview.frame.y,
                width: layout.snapPreview.frame.width,
                height: layout.snapPreview.frame.height,
                ...layout.stackingStyle,
              }}
            />
          )}
          {layout.divider ? (
            <div
              className="tourtois-divider"
              role="separator"
              aria-label="Main window width"
              aria-orientation="vertical"
              aria-valuemin={Math.round(layout.divider.min)}
              aria-valuemax={Math.round(layout.divider.max)}
              aria-valuenow={Math.round(layout.divider.position)}
              tabIndex={0}
              style={{ left: layout.divider.position, ...layout.stackingStyle }}
              {...layout.divider.props}
              onKeyDown={(event) => {
                if (!layout.divider) return;
                const step =
                  new Map([
                    ["ArrowLeft", -32],
                    ["ArrowRight", 32],
                  ]).get(event.key) ?? 0;
                if (step) {
                  event.preventDefault();
                  event.stopPropagation();
                  layout.resizeMain(layout.divider.position + step);
                }
              }}
            />
          ) : null}
        </MaosaicoRegion>
      </div>
      <ShellCommandDialogs
        host={appSurfaceHost}
        state={shellCommands}
        focusedWindow={activeWindow}
        directoryApps={directory.map((app) => ({
          commands: app.commands,
          name: app.displayName ?? "App",
          roles: app.roles,
          surfaceId: app.surfaceId,
        }))}
        onStatus={setAppStatus}
        finalFocus={() =>
          document.querySelector<HTMLButtonElement>(
            ".caps-app-bar-launcher-button",
          )
        }
      />
    </div>
  );
}
