import { IconButton } from "@fungi.computer/caps/components/icon-button";
import {
  AppStatusBar,
  StatusBarPicker,
} from "@fungi.computer/caps/blocks/app-status-bar";
import { Sigil } from "@fungi.computer/sigils";
import {
  WindowActions,
  WindowBody,
  WindowFrame,
  WindowHeader,
} from "@fungi.computer/caps/components/window";
import { Settings, ShieldCheck } from "lucide-react";
import { WindowStatusItem } from "./status-bar.js";
import {
  useLayer,
  useMaosaicoItem,
  useMaosaicoLayout,
} from "@fungi.computer/maosaico";
import {
  AppError,
  type AppStatusAction,
  type AppStatusItem as AppStatusItemData,
} from "@fungi.computer/agar";
import { useEffect, useRef, useState } from "react";
import { AppIcon } from "./app-icon.js";
import { useWindowMotion } from "./use-window-motion.js";
import { backHint } from "./shell-commands.js";
import {
  createAppWindowManager,
  type AppWindowProjection,
} from "./app-windows.js";
import { launchComputerId, type AppDirectoryApp } from "./app-launch.js";

const windowStatusLabel = (projection: AppWindowProjection): string => {
  if (projection.status === "error")
    return `${projection.launch.title} unavailable`;
  if (projection.status === "loading")
    return `${projection.launch.title} opening…`;
  return projection.launch.title;
};

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

export function AppPane({
  projection,
  icon,
  manager,
  onError,
  index,
  focusWindow,
  afterHide,
  onBack,
  onSelectComputer,
}: {
  projection: AppWindowProjection;
  icon: string | null | undefined;
  manager: ReturnType<typeof createAppWindowManager>;
  onError: (message: string) => void;
  index: number;
  focusWindow: (id: string) => void;
  afterHide: (id: string) => void;
  onBack: (id: string) => void;
  /** The person chose another of this window's offered Computers. */
  onSelectComputer: (windowId: string, computerId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [computerPickerOpen, setComputerPickerOpen] = useState(false);
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
  const element = useWindowMotion(binding, layout.interacting);
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
        {...(projection.navigation?.title === undefined
          ? {}
          : { subtitle: projection.navigation.title })}
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
          <>
            <WindowActions
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
          </>
        }
      />
      {projection.status === "loading" ? (
        <div className="tourtois-app-loading" role="status">
          <AppIcon roles={projection.launch.roles} icon={icon} />
          <div>
            <strong>Opening {projection.launch.title}…</strong>
            <span>Preparing this App for your workspace.</span>
          </div>
        </div>
      ) : null}
      {projection.status === "error" &&
      !(
        projection.error instanceof AppError &&
        projection.error.code === "DISCONNECTED"
      ) ? (
        <p className="tourtois-window-status" role="status">
          {windowStatusLabel(projection)}
        </p>
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
        computerPickerOpen={computerPickerOpen}
        onComputerPickerOpenChange={setComputerPickerOpen}
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
 * hands the person's use back to the App. A window with neither has no bar.
 */
export function WindowStatusBar({
  projection,
  onSelectComputer,
  onAction,
  surface,
  computerPickerOpen,
  onComputerPickerOpenChange,
}: {
  projection: AppWindowProjection;
  onSelectComputer: (computerId: string) => void;
  onAction: (action: AppStatusAction) => void;
  /** The App's own surface, which UI opened from the bar is placed against. */
  surface?: () => HTMLElement | null;
  computerPickerOpen?: boolean;
  onComputerPickerOpenChange?: (open: boolean) => void;
}) {
  const popover = useLayer("popover");
  const { computers, title } = projection.launch;
  const items = projection.statusItems;
  if (computers === undefined && items.length === 0) return null;
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
  const start = items.filter((item) => item.end !== true);
  return (
    <AppStatusBar
      className="tourtois-window-status-bar"
      aria-label={`${title} status`}
      attachment={
        computers === undefined ? undefined : (
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
            disabled={projection.status === "loading"}
            onSelect={onSelectComputer}
          />
        )
      }
      end={end.length === 0 ? undefined : end.map(render)}
    >
      {start.length === 0 ? undefined : start.map(render)}
    </AppStatusBar>
  );
}
