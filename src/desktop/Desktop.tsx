import type { AppOpenInput } from "@fungi.computer/agar/apps";
import { GillParamPicker } from "./gill-param-picker.js";
import type { DesktopGill, DesktopLayout } from "../desktop-layout.js";
import type { DesktopMethods, DesktopMutation } from "../desktop-api.js";
import type { WhistleJsonValue } from "@fungi.computer/whistle";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { arrangeBento, useMaosaicoBento } from "@fungi.computer/maosaico";
import type { AppStorage } from "@fungi.computer/agar/storage";
import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import type { AppGridItem } from "@fungi.computer/caps/blocks/launcher-grid";
import { Alert } from "@fungi.computer/caps/components/alert";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { GripVertical, Trash2 } from "lucide-react";
import { WORKBENCH_NOTICES } from "../app-toast.js";
import { toast } from "@fungi.computer/caps/components/toaster";
import { Badge } from "@fungi.computer/caps/components/badge";
import { Sigil } from "@fungi.computer/sigils";
import type { WorkbenchDirectory } from "@fungi.computer/nacre/workbench-directory";
import { DeclaredAppIcon } from "../app-icon.js";
import {
  createDesktopLayoutClient,
  type DesktopLayoutClient,
} from "../desktop-client.js";
import {
  availableDesktopLayout,
  desktopPlacements,
  desktopBentoIntent,
} from "../desktop-layout.js";
import { ArrangeToolbar } from "./arrange-toolbar.js";
import type { InstallingApp } from "@fungi.computer/nacre/workbench-directory";
import { LauncherGill } from "./launcher-gill.js";
import type { WidgetChoice } from "./widget-picker.js";
import { RowGill, type DesktopGillTransport } from "./row-gill.js";

export type DesktopProps = {
  phone: boolean;
  apps: WorkbenchDirectory["apps"];
  launcherItems: readonly AppBarItem[];
  needsUpdate: NonNullable<WorkbenchDirectory["needsUpdate"]>;
  onAppSettings: (app: WorkbenchDirectory["apps"][number]) => void;
  storage: AppStorage;
  methods: DesktopMethods;
  transport: DesktopGillTransport;
  paused: boolean;
  loading: boolean;
  unavailable: boolean;
  onRetryApps: () => void;
  onAllApps: () => void;
  /** Starter Apps a trial is still setting up, or could not set up. */
  installing?: readonly InstallingApp[] | undefined;
  onRetryInstall?: ((installationId: string) => Promise<void>) | undefined;
  onOpen: (target: AppOpenInput) => void;
  computersForGill?:
    | ((surfaceId: string) => readonly { computerId: string; name: string }[])
    | undefined;
  onOwner?: (owner: DesktopLayoutClient | null) => void;
  /** Arrange mode is a Layout-menu command, so the Workbench owns it. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
};
const gap = 16;
const rowHeight = 280;

/** The App owns one canonical four-column layout, never breakpoint storage. */
export function Desktop(props: DesktopProps) {
  const [owner, setOwner] = useState<DesktopLayoutClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let retired = false;
    let current: DesktopLayoutClient | undefined;
    setOwner(null);
    void createDesktopLayoutClient({
      storage: props.storage,
      methods: props.methods,
    })
      .then((next) => {
        if (retired) {
          next.close();
          return;
        }
        current = next;
        setError(null);
        setOwner(next);
        props.onOwner?.(next);
      })
      .catch((cause: unknown) => {
        console.error("Desktop arrangement read failed", cause);
        if (!retired) setError("Your desktop could not be loaded.");
      });
    return () => {
      retired = true;
      props.onOwner?.(null);
      current?.close();
    };
  }, [props.methods, props.storage, props.onOwner, retry]);
  // The backend resolves the desktop against its own App catalog. One owner
  // lives across directory polls; only a changed App set re-reads it.
  const catalog = JSON.stringify(
    props.apps.map((app) => [app.surfaceId, app.releaseId, app.availability]),
  );
  const readCatalog = useRef<string | null>(null);
  useEffect(() => {
    if (owner === null) return;
    if (readCatalog.current !== null && readCatalog.current !== catalog)
      owner.invalidate();
    readCatalog.current = catalog;
  }, [owner, catalog]);
  return (
    <div className="tourtois-desktop" data-desktop-bento>
      {error ? (
        <Alert
          tone="error"
          description={error}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRetry((value) => value + 1);
              }}
            >
              Retry
            </Button>
          }
        />
      ) : null}
      {!owner && !error ? (
        <LoadingState message="Loading your desktop…" />
      ) : null}
      {owner ? <ArrangedDesktop {...props} owner={owner} /> : null}
    </div>
  );
}

/** One plain line per refusal; the raw code goes to the console only. */
function refusalMessage(code: string): string {
  switch (code) {
    case "conflict":
      return "The desktop changed elsewhere. Try your change again.";
    case "too_large":
      return "This desktop arrangement is too large to save. Remove some widgets or Launcher preferences and try again.";
    case "last_launcher":
      return "Your desktop needs one Launcher.";
    case "quota_exceeded":
      return "The App's storage quota is full. Free some storage before saving again.";
    default:
      return "Couldn't save that change. Try again.";
  }
}

function ArrangedDesktop({
  owner,
  ...props
}: DesktopProps & {
  owner: DesktopLayoutClient;
}) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.get, owner.get);
  const catalog = snapshot.widgets;
  const visibleItems = availableDesktopLayout(snapshot.layout, catalog).items;
  const { editing, onEditingChange } = props;
  const [configuration, setConfiguration] = useState<{
    gill: DesktopGill;
    itemId?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [contentHeights, setContentHeights] = useState<
    ReadonlyMap<string, number>
  >(new Map());
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  const columns = props.phone ? 1 : 4;
  const isLauncher = (item: DesktopLayout["items"][number]) =>
    catalog.some(
      (gill) =>
        gill.kind === "launcher" &&
        gill.surfaceId === item.surfaceId &&
        gill.gillId === item.gillId,
    );
  const onlyLauncher = visibleItems.filter(isLauncher).length <= 1;
  const launcherGill = catalog.find((gill) => gill.kind === "launcher");
  useEffect(() => {
    setContentHeights((previous) => {
      const current = new Map(
        [...previous].filter(([id]) =>
          snapshot.layout.items.some((item) => item.id === id),
        ),
      );
      return current.size === previous.size ? previous : current;
    });
  }, [snapshot.layout.items]);
  const projected = desktopPlacements(snapshot.layout)
    .filter((cell) => visibleItems.some((item) => item.id === cell.id))
    .map((cell) => {
      const item = snapshot.layout.items.find((item) => item.id === cell.id);
      const kind = catalog.find(
        (gill) =>
          gill.surfaceId === item?.surfaceId && gill.gillId === item.gillId,
      )?.kind;
      // Launcher M needs two icon rows on phones. This is presentation only:
      // canonical sizes/cells still come from the four-column storage owner.
      return props.phone && item?.size === "M" && kind === "launcher"
        ? { ...cell, h: 2 }
        : cell;
    });
  const placements = arrangeBento(projected, columns);
  const save = async (
    method: DesktopMutation,
    input: Record<string, WhistleJsonValue>,
    scope: "member" | "team" = "member",
  ) => {
    setSaving(true);
    try {
      const result = await owner.mutate(method, {
        scope,
        basedOn:
          scope === "team" ? snapshot.teamRevision : snapshot.memberRevision,
        ...input,
      });
      if (result.kind !== "accepted")
        console.error("Desktop change refused", result.code);
      setError(result.kind === "accepted" ? null : refusalMessage(result.code));
      if (result.kind === "accepted") setSaved(true);
      return result.kind === "accepted";
    } catch (cause) {
      console.error("Desktop arrangement update failed", cause);
      setError("Your desktop change could not be confirmed.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const rowHeights = Array.from(
    {
      length: Math.max(0, ...placements.map((item) => item.row + item.h)),
    },
    (_, row) =>
      Math.max(
        0,
        ...placements
          .filter((item) => item.row <= row && row < item.row + item.h)
          .map((item) => {
            const declaration = snapshot.layout.items.find(
              (entry) => entry.id === item.id,
            );
            const canonical = item.h * rowHeight + (item.h - 1) * gap;
            const natural = contentHeights.get(item.id) ?? canonical;
            const isLauncher =
              declaration !== undefined &&
              catalog.some(
                (gill) =>
                  gill.kind === "launcher" &&
                  gill.surfaceId === declaration.surfaceId &&
                  gill.gillId === declaration.gillId,
              );
            // Launchers grow to show their Apps; row Gills stay bounded and
            // scroll once populated. Both fit their content when it is short.
            const height = isLauncher ? natural : Math.min(natural, canonical);
            return Math.max(0, height - (item.h - 1) * gap) / item.h;
          }),
      ),
  );
  const binding = useMaosaicoBento({
    placements,
    columns,
    width,
    rowHeight,
    rowHeights,
    gap,
    enabled: editing && !saving,
    onChange: (ops) => {
      // Maosaico emits one completed drag or keyboard intent per change.
      const op = ops[0];
      const intent = op
        ? desktopBentoIntent(snapshot.layout, placements, op)
        : null;
      if (intent?.kind === "move")
        void save("layout.move", { id: intent.id, to: intent.to });
      else if (intent?.kind === "resize")
        void save("layout.resize", { id: intent.id, size: intent.size });
    },
  });
  const frames = [...binding.frames.values()];
  const height = Math.max(0, ...frames.map((frame) => frame.y + frame.height));
  // Phones and arranging fit each card to its content. Otherwise cards that
  // share a row reach the tallest neighbour's bottom, so Inbox matches Launcher.
  const evenRows = !props.phone;
  const evenRowHeight = (id: string) => {
    const frame = binding.frames.get(id);
    const cell = placements.find((entry) => entry.id === id);
    if (!frame || !cell) return 0;
    const bottom = Math.max(
      frame.y + frame.height,
      ...placements
        .filter(
          (other) =>
            other.row < cell.row + cell.h && cell.row < other.row + other.h,
        )
        .map((other) => {
          const otherFrame = binding.frames.get(other.id);
          return otherFrame ? otherFrame.y + otherFrame.height : 0;
        }),
    );
    return bottom - frame.y;
  };
  const warnings: readonly AppGridItem[] = [
    ...props.apps
      .filter(
        (app) =>
          app.availability !== "available" ||
          app.releaseId === null ||
          app.surface === null,
      )
      .map((app) => ({
        id: `unavailable:${app.surfaceId}`,
        label: app.displayName ?? "App",
        icon: <DeclaredAppIcon icon={app.icon} />,
        muted: true,
        status: (
          <Badge role="status" tone="warning" variant="quiet" size="sm">
            Unavailable · Settings
          </Badge>
        ),
        onSelect: () => {
          props.onAppSettings(app);
        },
      })),
    ...props.needsUpdate.map((app, index) => ({
      id: `needs-update:${app.installationId ?? app.appId ?? String(index)}`,
      label: app.displayName,
      icon: <Sigil name="installApps" />,
      disabled: true,
      status: (
        <Badge role="status" tone="warning" variant="quiet" size="sm">
          Needs update
        </Badge>
      ),
      onSelect: () => undefined,
    })),
  ];
  const choices: readonly WidgetChoice[] = catalog.map((gill) => {
    const app = props.apps.find((entry) => entry.surfaceId === gill.surfaceId);
    return {
      gill,
      placed: visibleItems.some(
        (item) =>
          item.surfaceId === gill.surfaceId && item.gillId === gill.gillId,
      ),
      appName: app?.displayName ?? "Desktop",
      icon: app ? (
        <DeclaredAppIcon icon={app.icon} />
      ) : (
        <Sigil name="allApps" />
      ),
    };
  });
  const addWidget = (gill: DesktopGill) => {
    const size = gill.sizes[0];
    if (!size) return;
    if ((gill.params?.length ?? 0) > 0) setConfiguration({ gill });
    else
      void save("layout.place", {
        surfaceId: gill.surfaceId,
        gillId: gill.gillId,
        size,
      });
  };
  const finishArranging = () => {
    if (saved)
      toast("Desktop saved", {
        id: "desktop-saved",
        toasterId: WORKBENCH_NOTICES,
      });
    setSaved(false);
    onEditingChange(false);
  };
  const longPress = useRef<number | undefined>(undefined);
  return (
    <>
      {snapshot.refreshFailure ? (
        <Alert tone="warning" description={snapshot.refreshFailure.message} />
      ) : null}
      {editing ? (
        <ArrangeToolbar
          phone={props.phone}
          status={saving ? "saving" : saved ? "saved" : "idle"}
          error={error}
          canWriteTeam={snapshot.canWriteTeam}
          choices={choices}
          saving={saving}
          onChoose={addWidget}
          onReset={async () => {
            if (!(await save("layout.reset", {})))
              throw new Error("The layout was not reset");
          }}
          onSaveTeam={() => {
            void save("layout.set", { layout: snapshot.layout }, "team");
          }}
          onDone={finishArranging}
        />
      ) : null}
      {configuration ? (
        <GillParamPicker
          key={
            configuration.itemId ??
            `${configuration.gill.surfaceId}:${configuration.gill.gillId}`
          }
          gill={configuration.gill}
          initialParams={
            snapshot.layout.items.find(
              (item) => item.id === configuration.itemId,
            )?.params
          }
          computers={
            props.computersForGill?.(configuration.gill.surfaceId) ?? []
          }
          transport={props.transport}
          editing={configuration.itemId !== undefined}
          onClose={() => {
            setConfiguration(null);
          }}
          onSave={(params) => {
            if (configuration.itemId !== undefined)
              return save("layout.set", {
                layout: {
                  ...snapshot.layout,
                  items: snapshot.layout.items.map((item) =>
                    item.id === configuration.itemId
                      ? { ...item, params }
                      : item,
                  ),
                },
              });
            const size = configuration.gill.sizes[0];
            return size
              ? save("layout.place", {
                  surfaceId: configuration.gill.surfaceId,
                  gillId: configuration.gill.gillId,
                  size,
                  params,
                })
              : Promise.resolve(false);
          }}
        />
      ) : null}
      {snapshot.notice ? (
        <Alert tone="info" description={snapshot.notice} />
      ) : null}
      {visibleItems.length === 0 ? (
        <div className="tourtois-desktop-empty">
          <EmptyState
            variant="panel"
            title="Your desktop is empty"
            description="Restore the Launcher to get back to your Apps."
            actions={
              <Button
                disabled={saving}
                onClick={() => {
                  const size = launcherGill?.sizes.includes("M")
                    ? "M"
                    : launcherGill?.sizes[0];
                  if (launcherGill && size)
                    void save("layout.place", {
                      surfaceId: launcherGill.surfaceId,
                      gillId: launcherGill.gillId,
                      size,
                    });
                  else void save("layout.reset", {});
                }}
              >
                Restore Launcher
              </Button>
            }
          />
        </div>
      ) : null}
      {error && !editing ? <Alert tone="error" description={error} /> : null}
      <div
        ref={stage}
        className="tourtois-desktop-stage"
        style={{ height }}
        data-desktop-columns={columns}
        data-preview={binding.preview}
        data-arranging={editing ? "" : undefined}
      >
        {visibleItems.map((item) => {
          const frame = binding.frames.get(item.id);
          const gill = catalog.find(
            (gill) =>
              gill.surfaceId === item.surfaceId && gill.gillId === item.gillId,
          );
          if (!frame || !gill) return null;
          const controls = editing ? (
            <div className="tourtois-arrange-controls">
              <IconButton
                size="responsive"
                aria-label={`Move ${gill.title}`}
                title={`Move ${gill.title}`}
                icon={<GripVertical />}
                {...binding.bind(item.id, "move")}
              />
              <div
                className="join tourtois-gill-sizes"
                role="group"
                aria-label={`Size of ${gill.title}`}
              >
                {gill.sizes.map((size) => (
                  <IconButton
                    key={size}
                    className="join-item"
                    size="sm"
                    icon={size}
                    aria-label={`Size ${size === "S" ? "small" : size === "M" ? "medium" : "large"}`}
                    title={`${gill.title}: ${size}`}
                    variant={size === item.size ? "secondary" : "ghost"}
                    aria-pressed={size === item.size}
                    disabled={saving}
                    onClick={() => {
                      void save("layout.resize", { id: item.id, size });
                    }}
                  />
                ))}
              </div>
              {/* A disabled button fires no pointer events, so the reason sits on its wrapper. */}
              <span
                title={
                  onlyLauncher && isLauncher(item)
                    ? "Your desktop needs one Launcher"
                    : undefined
                }
              >
                <IconButton
                  size="responsive"
                  aria-label={`Remove ${gill.title}`}
                  title={`Remove ${gill.title}`}
                  icon={<Trash2 />}
                  disabled={saving || (onlyLauncher && isLauncher(item))}
                  onClick={() => {
                    void save("layout.remove", { id: item.id });
                  }}
                />
              </span>
            </div>
          ) : undefined;
          const onContentHeight = (height: number) => {
            setContentHeights((previous) =>
              previous.get(item.id) === height
                ? previous
                : new Map(previous).set(item.id, height),
            );
          };
          const app = props.apps.find(
            (app) => app.surfaceId === item.surfaceId,
          );
          const declaration = app?.gills.find(
            (declaration) => declaration.id === item.gillId,
          );
          return (
            <div
              key={item.id}
              data-desktop-gill={item.id}
              className="tourtois-desktop-tile"
              style={{
                left: frame.x,
                top: frame.y,
                width: frame.width,
                height: evenRows
                  ? evenRowHeight(item.id)
                  : Math.min(
                      contentHeights.get(item.id) ?? frame.height,
                      frame.height,
                    ),
              }}
              onPointerDown={(event) => {
                // Touch has no menu to reach Arrange from: a long press enters it.
                if (editing || event.pointerType !== "touch") return;
                window.clearTimeout(longPress.current);
                longPress.current = window.setTimeout(() => {
                  onEditingChange(true);
                }, 600);
              }}
              onPointerUp={() => {
                window.clearTimeout(longPress.current);
              }}
              onPointerMove={() => {
                window.clearTimeout(longPress.current);
              }}
              onPointerCancel={() => {
                window.clearTimeout(longPress.current);
              }}
            >
              <div
                className="tourtois-desktop-tile-body"
                ref={(node) => {
                  if (node) node.inert = editing;
                }}
              >
                {gill.kind === "launcher" ? (
                  <LauncherGill
                    items={props.launcherItems}
                    size={item.size}
                    onAllApps={props.onAllApps}
                    installing={props.installing ?? []}
                    onRetryInstall={props.onRetryInstall}
                    loading={props.loading}
                    unavailable={props.unavailable}
                    onRetry={props.onRetryApps}
                    warnings={warnings}
                    preferences={snapshot.layout.launcher}
                    onPreference={(id, state) => {
                      void save("layout.launcher", { appId: id, state });
                    }}
                    editHandle={
                      editing ? <span aria-hidden="true" /> : undefined
                    }
                    onContentHeight={onContentHeight}
                  />
                ) : declaration && app ? (
                  <RowGill
                    key={JSON.stringify(item.params ?? {})}
                    surfaceId={item.surfaceId}
                    appHeader={{
                      name: app.displayName ?? "App",
                      icon: <DeclaredAppIcon icon={app.icon} />,
                    }}
                    declaration={declaration}
                    params={item.params}
                    size={item.size}
                    paused={props.paused}
                    transport={props.transport}
                    onOpen={(target) => {
                      props.onOpen({
                        appId: app.appId,
                        intent: { kind: "navigate", params: target.params },
                      });
                    }}
                    onConfigure={() => {
                      setConfiguration({ gill, itemId: item.id });
                    }}
                    launch={props.launcherItems.find(
                      (app) => app.id === `app:${item.surfaceId}`,
                    )}
                    editHandle={
                      editing ? <span aria-hidden="true" /> : undefined
                    }
                    onContentHeight={onContentHeight}
                  />
                ) : null}
              </div>
              {controls}
            </div>
          );
        })}
      </div>
    </>
  );
}
