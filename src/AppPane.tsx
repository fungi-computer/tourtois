import type { ReactNode } from "react";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { ResultState } from "@fungi.computer/caps/blocks/result-state";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import {
  AppStatusBar,
  AppStatusItem,
  StatusBarChip,
  StatusBarPicker,
} from "@fungi.computer/caps/blocks/app-status-bar";
import { Sigil } from "@fungi.computer/sigils";
import { describeAppError } from "@fungi.computer/agar/errors";
import {
  WindowActions,
  WindowBody,
  WindowFrame,
  WindowHeader,
} from "@fungi.computer/caps/components/window";
import { Ellipsis, Settings, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { WindowStatusItem } from "./status-bar.js";
import {
  useLayer,
  useMaosaicoItem,
  useMaosaicoLayout,
} from "@fungi.computer/maosaico";
import {
  AppError,
  type AppNavigationActivation,
  type AppNavigationState,
  type AppStatusAction,
  type AppStatusItem as AppStatusItemData,
} from "@fungi.computer/agar";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { AppIcon } from "./app-icon.js";
import { useWindowMotion } from "./use-window-motion.js";
import { backHint } from "./shell-commands.js";
import {
  createAppWindowManager,
  type AppWindowProjection,
  type AppLaunchDescriptor,
} from "./app-windows.js";
import { useDismissOverlays } from "./layers.js";
import { launchComputerId, type AppDirectoryApp } from "./app-launch.js";

/**
 * The App's own path, commands and state, when it publishes them; an App
 * that publishes none keeps the title and subtitle in its header.
 */
function headerContent(
  navigation: AppNavigationState | null,
  popover: HTMLElement | null,
  activate: (activation: AppNavigationActivation) => void,
  phone: boolean,
): Partial<ComponentProps<typeof WindowHeader>> {
  if (navigation?.crumbs === undefined || navigation.crumbs.length === 0)
    return {};
  let content: Partial<ComponentProps<typeof WindowHeader>> = {
    // Long App paths conventionally start with the App and Item, then view
    // and version. Keep the Item and current place; the menu retains the rest.
    crumbs:
      phone && navigation.crumbs.length > 3
        ? [...navigation.crumbs.slice(1, 2), ...navigation.crumbs.slice(-1)]
        : navigation.crumbs,
    popover,
    onCrumb: (crumbId, siblingId) => {
      activate(
        siblingId === undefined
          ? { kind: "crumb", crumbId }
          : { kind: "crumb", crumbId, siblingId },
      );
    },
    onAction: (actionId) => {
      activate({ kind: "action", actionId });
    },
  };
  if (navigation.primary !== undefined)
    content = {
      ...content,
      primary: phone
        ? navigation.primary.slice(0, 1).map((command) => {
            const labelled = { ...command };
            delete labelled.icon;
            return labelled;
          })
        : navigation.primary,
    };
  if (!phone && navigation.menu !== undefined)
    content = { ...content, menu: navigation.menu };
  if (navigation.status !== undefined)
    content = { ...content, status: navigation.status };
  return content;
}

/** The shell's phone breakpoint also selects its compact command presentation. */
function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => {
      setPhone(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  return phone;
}

/** The focused window's App-level settings; its Computer lives in its status bar. */
export function FocusedWindowControls({
  app,
  onOpenSettings,
  onOpenPermissions,
  projection,
}: {
  app: AppDirectoryApp | undefined;
  onOpenSettings: () => void;
  onOpenPermissions: () => void;
  projection: AppWindowProjection;
}) {
  if (!app) return null;
  return (
    <div
      className="tourtois-focused-controls"
      role="group"
      aria-label={`${projection.launch.title} settings`}
    >
      <IconButton
        size="responsive"
        aria-label={`Permissions for ${projection.launch.title}`}
        title="App permissions"
        icon={<ShieldCheck />}
        onClick={onOpenPermissions}
      />
      <IconButton
        size="responsive"
        aria-label={`Settings for ${projection.launch.title}`}
        title="App settings"
        icon={<Settings />}
        onClick={onOpenSettings}
      />
    </div>
  );
}

/** The window's failure card: what happened, what to try, one primary way out. */
function WindowFailure({
  projection,
  onReopen,
}: {
  projection: AppWindowProjection;
  onReopen: () => void;
}) {
  const { title: appTitle } = projection.launch;
  const lost =
    projection.error instanceof AppError &&
    projection.error.code === "DISCONNECTED";
  const described = describeAppError(projection.error);
  return (
    <ResultState
      className="tourtois-window-failure"
      tone="failed"
      headingLevel={3}
      title={lost ? "This App lost its connection" : described.title}
      description={
        <>
          {lost ? `${appTitle} stopped answering.` : described.message}
          <span className="tourtois-window-failure-note">
            A request may have finished even if its reply did not arrive, so
            check before repeating it.
          </span>
        </>
      }
      actions={
        <>
          <Button type="button" variant="primary" onClick={onReopen}>
            Reopen {appTitle}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload workspace
          </Button>
        </>
      }
    />
  );
}

/** Places folded out of a phone's trail stay available in the same menu. */
function PhonePathMenu({
  crumbs,
  onAction,
}: {
  crumbs: AppNavigationState["crumbs"];
  onAction: (activation: AppNavigationActivation) => void;
}) {
  if (crumbs === undefined || crumbs.length <= 3) return null;
  return crumbs.flatMap((crumb, index) =>
    index === 1 || index === crumbs.length - 1
      ? []
      : [
          <DropdownMenuItem
            key={`crumb:${crumb.id}`}
            onSelect={() => {
              onAction({ kind: "crumb", crumbId: crumb.id });
            }}
          >
            {crumb.label}
          </DropdownMenuItem>,
          ...(crumb.siblings ?? []).map((sibling) => (
            <DropdownMenuItem
              key={`crumb:${crumb.id}:${sibling.id}`}
              onSelect={() => {
                onAction({
                  kind: "crumb",
                  crumbId: crumb.id,
                  siblingId: sibling.id,
                });
              }}
            >
              {crumb.label} · {sibling.label}
            </DropdownMenuItem>
          )),
        ],
  );
}

/** One maintained command menu on phones; ordinary window keys on desktop. */
function AppWindowControls({
  phone,
  navigation,
  onAction,
  popover,
  ...actions
}: ComponentProps<typeof WindowActions> & {
  onToggleMaximize: () => void;
  onMinimize: () => void;
  onClose: () => void;
  phone: boolean;
  navigation: AppNavigationState | null;
  onAction: (activation: AppNavigationActivation) => void;
  popover: HTMLElement | null;
}) {
  if (!phone) return <WindowActions {...actions} />;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <IconButton
            icon={<Ellipsis />}
            aria-label={`More for ${actions.title}`}
          />
        }
      />
      <DropdownMenuContent align="end" container={popover}>
        <PhonePathMenu crumbs={navigation?.crumbs} onAction={onAction} />
        {[
          ...(navigation?.primary?.slice(1) ?? []),
          ...(navigation?.menu ?? []),
        ].map((command) => (
          <DropdownMenuItem
            key={command.id}
            disabled={command.disabled === true}
            variant={command.tone === "destructive" ? "destructive" : "default"}
            onSelect={() => {
              onAction({ kind: "action", actionId: command.id });
            }}
          >
            {command.label}
          </DropdownMenuItem>
        ))}
        {actions.onPromote ? (
          <DropdownMenuItem onSelect={actions.onPromote}>
            Make main window
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={actions.onToggleMaximize}>
          {actions.maximized ? "Restore window" : "Maximize window"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.onMinimize}>
          Minimize window
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={actions.onClose}>
          Close window
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppPane({
  projection,
  nextLaunch,
  icon,
  manager,
  onError,
  index,
  focusWindow,
  afterHide,
  onBack,
  onSelectComputer,
  onChooseComputer,
}: {
  projection: AppWindowProjection;
  nextLaunch?: AppLaunchDescriptor | null;
  icon: string | null | undefined;
  manager: ReturnType<typeof createAppWindowManager>;
  onError: (message: string) => void;
  index: number;
  focusWindow: (id: string) => void;
  afterHide: (id: string) => void;
  onBack: (id: string) => void;
  /** The person chose another of this window's offered Computers. */
  onSelectComputer: (windowId: string, computerId: string) => void;
  /** No Computer is granted: open the App's permissions to grant one. */
  onChooseComputer: (surfaceId: string) => void;
}) {
  const phone = usePhone();
  const containerRef = useRef<HTMLDivElement>(null);
  const popover = useLayer("popover");
  const [computerPickerOpen, setComputerPickerOpen] = useState(false);
  const dismissOthers = useDismissOverlays();
  useEffect(() => {
    if (projection.launch.computers === undefined) return;
    return manager.registerComputerChoice(projection.windowId, () => {
      setComputerPickerOpen(true);
    });
  }, [
    manager,
    projection.windowId,
    projection.generation,
    projection.launch.computers,
  ]);
  useEffect(() => {
    if (containerRef.current)
      containerRef.current.inert = projection.status !== "ready";
  }, [projection.status]);
  const binding = useMaosaicoItem(
    {
      id: projection.windowId,
      frame: {
        x: 24 + index * 40,
        y: 24 + index * 32,
        width: 600,
        height: 480,
      },
      minima: { width: 320, height: 360 },
    },
    { participating: projection.status !== "minimized" },
  );
  const layout = useMaosaicoLayout();
  const element = useWindowMotion(binding, layout.interacting, layout.bounds);
  const zoomed = layout.zoomedId === projection.windowId;
  const zoom = () => {
    layout.zoom(zoomed ? null : projection.windowId);
    focusWindow(projection.windowId);
  };
  const close = () => {
    void manager
      .close(projection.windowId)
      .then(() => {
        // The App may veto a close to protect unsaved work.
        if (
          !manager
            .read()
            .windows.some((item) => item.windowId === projection.windowId)
        )
          afterHide(projection.windowId);
      })
      .catch((cause: unknown) => {
        console.error("App workbench operation failed", cause);

        onError("App could not be closed.");
      });
  };
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    parent.appendChild(projection.container);
    manager.attach(projection.windowId);
    return () => {
      projection.container.remove();
    };
  }, [manager, projection.container, projection.windowId]);

  return (
    <WindowFrame
      ref={element}
      className="tourtois-pane tourtois-app-pane"
      aria-label={projection.launch.title}
      active={binding.active}
      floating={layout.mode === "floating" && !zoomed}
      data-window-id={projection.windowId}
      data-app-id={projection.launch.appId}
      data-installation-id={projection.launch.installationId ?? undefined}
      data-surface-id={projection.launch.surfaceId}
      data-release-id={projection.launch.releaseId}
      hidden={projection.status === "minimized" || !binding.visible}
      onFocusCapture={() => {
        binding.focus();
      }}
      onPointerDownCapture={() => {
        binding.focus();
      }}
      // The mouse back button over this window's chrome is its App's Back;
      // inside the App, Agar maps it the same way.
      onMouseUp={(event) => {
        if (event.button !== 3 || projection.navigation?.canGoBack !== true)
          return;
        event.preventDefault();
        onBack(projection.windowId);
      }}
      style={binding.stackingStyle}
    >
      {/* Tiled windows keep a slim bar so Back and the window controls
          always have a home; floating windows keep the regular bar. */}
      <WindowHeader
        title={projection.launch.title}
        data-phone-compact={phone || undefined}
        {...(projection.navigation?.title === undefined
          ? {}
          : { subtitle: projection.navigation.title })}
        {...headerContent(
          projection.navigation,
          popover,
          (activation) => {
            void manager
              .activateNavigation(projection.windowId, activation)
              .catch((cause: unknown) => {
                console.error("App workbench operation failed", cause);
                onError("App could not handle that action.");
              });
          },
          phone,
        )}
        density={layout.mode === "tiled" ? "compact" : "regular"}
        icon={<AppIcon roles={projection.launch.roles} icon={icon} />}
        {...(projection.navigation?.canGoBack === true
          ? {
              back: {
                label: `Back in ${projection.launch.title}`,
                hint: backHint(),
                onBack: () => {
                  onBack(projection.windowId);
                },
              },
            }
          : {})}
        handleProps={{
          ...binding.props,
          onClick: binding.focus,
          onDoubleClick: zoom,
        }}
        actions={
          <AppWindowControls
            phone={phone}
            navigation={projection.navigation}
            popover={popover}
            onAction={(activation) => {
              void manager
                .activateNavigation(projection.windowId, activation)
                .catch((cause: unknown) => {
                  console.error("App workbench operation failed", cause);
                  onError("App could not handle that action.");
                });
            }}
            title={projection.launch.title}
            maximized={zoomed}
            {...(layout.mode === "tiled" &&
            layout.order[0] !== projection.windowId
              ? {
                  onPromote: () => {
                    const main = layout.order[0];
                    if (main) layout.swap(projection.windowId, main);
                    focusWindow(projection.windowId);
                  },
                }
              : {})}
            onToggleMaximize={zoom}
            onMinimize={() => {
              void manager
                .minimize(projection.windowId)
                .then(() => {
                  afterHide(projection.windowId);
                })
                .catch((cause: unknown) => {
                  console.error("App workbench operation failed", cause);

                  onError("App could not be minimized.");
                });
            }}
            onClose={close}
          />
        }
      />
      {projection.status === "loading" ||
      projection.status === "getting-ready" ? (
        <LoadingState
          className="tourtois-app-loading"
          framed={false}
          icon={<AppIcon roles={projection.launch.roles} icon={icon} />}
          variant={projection.status === "getting-ready" ? "square" : "line"}
          message={
            projection.status === "getting-ready"
              ? `Getting ${projection.launch.title} ready…`
              : `Opening ${projection.launch.title}…`
          }
          detail="Preparing this App for your workspace."
        />
      ) : null}
      {projection.status === "error" ? (
        <div className="tourtois-window-status">
          <WindowFailure
            projection={projection}
            onReopen={() => {
              void manager
                .replace(projection.windowId, projection.launch)
                .catch((cause: unknown) => {
                  console.error("App reopen failed", cause);
                  onError("App could not be reopened.");
                });
            }}
          />
        </div>
      ) : null}
      {/* The App's sandboxed frame lives in this body for the window's whole
          life: it moves, clips and stacks with the window. A click into it
          raises the window through the App's own focus report. */}
      <WindowBody
        ref={containerRef}
        className="tourtois-pane-body"
        hidden={projection.status === "error"}
      />
      <WindowStatusBar
        projection={projection}
        onReload={
          nextLaunch && nextLaunch.releaseId !== projection.launch.releaseId
            ? () => {
                void manager
                  .replace(projection.windowId, nextLaunch)
                  .catch((cause: unknown) => {
                    console.error("App reload failed", cause);
                    onError("App could not be reloaded.");
                  });
              }
            : undefined
        }
        onChooseComputer={() => {
          onChooseComputer(projection.launch.surfaceId);
        }}
        computerPickerOpen={computerPickerOpen}
        onComputerPickerOpenChange={(open) => {
          if (open) dismissOthers();
          setComputerPickerOpen(open);
        }}
        onSelectComputer={(computerId) => {
          onSelectComputer(projection.windowId, computerId);
        }}
        surface={() => containerRef.current}
        onAction={(action) => {
          void manager
            .activateStatus(projection.windowId, action)
            .catch((cause: unknown) => {
              console.error("App workbench operation failed", cause);
              onError("App could not handle that action.");
            });
        }}
      />
    </WindowFrame>
  );
}

/**
 * One window's status bar, owned by the shell like its title bar: the
 * window's Computer first (only the person changes it, here), then the items
 * the App declared as data. The shell renders every item with Caps pieces and
 * hands the person's use back to the App. Release availability shares this
 * existing footer instead of competing with App navigation in the header.
 * Reload sits beside the App's far-end readouts. Phone chrome keeps one row:
 * a shorter notice takes precedence over Inkcap's low-value file count, never
 * over the App's save state. Desktop presentation stays unchanged.
 */
export function WindowStatusBar({
  projection,
  onSelectComputer,
  onAction,
  surface,
  computerPickerOpen,
  onComputerPickerOpenChange,
  onReload,
  onChooseComputer,
}: {
  projection: AppWindowProjection;
  onSelectComputer: (computerId: string) => void;
  onAction: (action: AppStatusAction) => void;
  /** The App's own surface, which UI opened from the bar is placed against. */
  surface?: () => HTMLElement | null;
  computerPickerOpen?: boolean;
  onComputerPickerOpenChange?: (open: boolean) => void;
  /** Uses the window manager's ordinary, veto-respecting replacement. */
  onReload?: (() => void) | undefined;
  /** With no Computer granted, the chip that opens the App's permissions. */
  onChooseComputer?: (() => void) | undefined;
}) {
  const popover = useLayer("popover");
  const phone = usePhone();
  const { computers, title } = projection.launch;
  const items = projection.statusItems;
  if (computers === undefined && items.length === 0 && !onReload)
    // While the App opens, an empty bar holds the footer's height so the
    // window does not jump when the readouts arrive.
    return projection.status === "loading" ||
      projection.status === "getting-ready" ? (
      <AppStatusBar aria-hidden="true" className="tourtois-window-status-bar" />
    ) : null;
  const anchorFor = (key: HTMLElement): AppStatusAction["anchor"] => {
    const origin = surface?.()?.getBoundingClientRect();
    if (!origin) return undefined;
    const rect = key.getBoundingClientRect();
    return {
      start: Math.max(0, rect.left - origin.left),
      width: Math.max(0, rect.width),
    };
  };
  const render = (item: AppStatusItemData) => (
    <WindowStatusItem
      key={item.id}
      item={item}
      container={popover}
      onAction={onAction}
      anchorFor={anchorFor}
    />
  );
  const end = items.filter((item) => item.end === true);
  const start = items.filter(
    (item) =>
      item.end !== true &&
      !(phone && item.kind === "text" && item.priority === "low"),
  );
  const appReadouts = end.length === 0 ? undefined : end.map(render);
  // Zero Computers: a chip to grant one. One is not a choice, so the picker
  // appears from two.
  let attachment: ReactNode;
  if (computers === undefined || computers.length === 1) attachment = undefined;
  else if (computers.length === 0)
    attachment = (
      <StatusBarChip label="Choose Computer" onClick={onChooseComputer} />
    );
  else
    attachment = (
      <StatusBarPicker
        {...(computerPickerOpen === undefined
          ? {}
          : { open: computerPickerOpen })}
        {...(onComputerPickerOpenChange === undefined
          ? {}
          : { onOpenChange: onComputerPickerOpenChange })}
        noun="Computer"
        pluralNoun="Computers"
        accessibleLabel={`Choose Computer for ${title}`}
        icon={<Sigil name="computer" size={16} />}
        options={computers.map((computer) => ({
          id: computer.computerId,
          label: computer.name,
        }))}
        value={launchComputerId(projection.launch.href)}
        emptyMessage="No Computers are granted to this App"
        disabled={
          projection.status === "loading" ||
          projection.status === "getting-ready"
        }
        onSelect={onSelectComputer}
      />
    );
  return (
    <AppStatusBar
      className="tourtois-window-status-bar"
      aria-label={`${title} status`}
      attachment={attachment}
      end={
        onReload ? (
          <span
            className={
              phone
                ? "flex min-w-0 items-center gap-xs"
                : "flex min-w-0 flex-wrap items-center gap-xs"
            }
          >
            {appReadouts}
            <AppStatusItem>
              <span role="status">
                {phone ? "Update ready" : "New version available"}
              </span>
              <StatusBarChip
                label="Reload"
                aria-label={`Reload ${title}`}
                onClick={onReload}
              />
            </AppStatusItem>
          </span>
        ) : (
          appReadouts
        )
      }
    >
      {start.length === 0 ? undefined : start.map(render)}
    </AppStatusBar>
  );
}
