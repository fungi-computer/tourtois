import type { AppOpenInput } from "@fungi.computer/agar/apps";
import { GillParamPicker } from "./gill-param-picker.js";
import type { DesktopGill } from "../desktop-layout.js";
import type { DesktopMethods, DesktopMutation } from "../desktop-api.js";
import type { WhistleJsonValue } from "@fungi.computer/whistle";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { arrangeBento, useMaosaicoBento } from "@fungi.computer/maosaico";
import type { AppStorage } from "@fungi.computer/agar/storage";
import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import type { AppGridItem } from "@fungi.computer/caps/blocks/launcher-grid";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { GripVertical, Trash2 } from "lucide-react";
import { Select } from "@fungi.computer/caps/components/select";
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
import { LauncherGill } from "./launcher-gill.js";
import { RowGill, type DesktopGillTransport } from "./row-gill.js";

export type DesktopProps = {
  phone: boolean;
  apps: WorkbenchDirectory["apps"];
  inboxSurfaceId: string | null;
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
  }, [
    props.methods,
    props.storage,
    props.apps,
    props.inboxSurfaceId,
    props.onOwner,
    retry,
  ]);
  return (
    <div className="tourtois-desktop" data-desktop-bento>
      {error ? (
        <p role="alert">
          {error}{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </p>
      ) : null}
      {!owner && !error ? <p role="status">Loading desktop…</p> : null}
      {owner ? <ArrangedDesktop {...props} owner={owner} /> : null}
    </div>
  );
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
      setError(
        result.kind === "accepted"
          ? null
          : result.code === "conflict"
            ? "The desktop changed elsewhere. Try your change again."
            : result.code === "too_large"
              ? "This desktop arrangement is too large to save. Remove some widgets or Launcher preferences and try again."
              : result.code === "quota_exceeded"
                ? "The App's storage quota is full. Free some storage before saving again."
                : `Desktop change refused: ${result.code}.`,
      );
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
            const isLauncher =
              declaration !== undefined &&
              catalog.some(
                (gill) =>
                  gill.kind === "launcher" &&
                  gill.surfaceId === declaration.surfaceId &&
                  gill.gillId === declaration.gillId,
              );
            const canonical = item.h * rowHeight + (item.h - 1) * gap;
            const natural = contentHeights.get(item.id) ?? canonical;
            const height = isLauncher
              ? props.phone
                ? natural
                : Math.max(canonical, natural)
              : props.phone
                ? Math.min(natural, canonical)
                : canonical;
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
  return (
    <>
      {snapshot.refreshFailure ? (
        <p role="alert">{snapshot.refreshFailure.message}</p>
      ) : null}
      {editing ? (
        <div className="tourtois-desktop-controls">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onEditingChange(false);
            }}
          >
            Done arranging
          </Button>
          <div className="tourtois-desktop-add-gill">
            <Select
              aria-label="Add widget"
              value=""
              disabled={saving}
              onChange={(event) => {
                const gill = catalog[Number(event.currentTarget.value)];
                const size = gill?.sizes[0];
                if (gill && size && (gill.params?.length ?? 0) > 0)
                  setConfiguration({ gill });
                else if (gill && size)
                  void save("layout.place", {
                    surfaceId: gill.surfaceId,
                    gillId: gill.gillId,
                    size,
                  });
              }}
            >
              <option value="">Add widget…</option>
              {catalog.map((gill, index) => (
                <option key={`${gill.surfaceId}:${gill.gillId}`} value={index}>
                  {gill.title}
                </option>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              void save("layout.reset", {});
            }}
          >
            Reset to Team default
          </Button>
          {snapshot.canWriteTeam ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                void save("layout.set", { layout: snapshot.layout }, "team");
              }}
            >
              Save as Team default
            </Button>
          ) : null}
        </div>
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
      {snapshot.notice ? <p role="alert">{snapshot.notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div
        ref={stage}
        className="tourtois-desktop-stage"
        style={{ height }}
        data-desktop-columns={columns}
        data-preview={binding.preview}
      >
        {visibleItems.map((item) => {
          const frame = binding.frames.get(item.id);
          const gill = catalog.find(
            (gill) =>
              gill.surfaceId === item.surfaceId && gill.gillId === item.gillId,
          );
          if (!frame || !gill) return null;
          const controls = editing ? (
            <div className="tourtois-gill-controls">
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
                    size="xs"
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
              <IconButton
                size="responsive"
                aria-label={`Remove ${gill.title}`}
                title={`Remove ${gill.title}`}
                icon={<Trash2 />}
                disabled={saving}
                onClick={() => {
                  void save("layout.remove", { id: item.id });
                }}
              />
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
                height: frame.height,
              }}
            >
              {gill.kind === "launcher" ? (
                <LauncherGill
                  items={props.launcherItems}
                  size={item.size}
                  onAllApps={props.onAllApps}
                  loading={props.loading}
                  unavailable={props.unavailable}
                  onRetry={props.onRetryApps}
                  warnings={warnings}
                  preferences={snapshot.layout.launcher}
                  onPreference={(id, state) => {
                    void save("layout.launcher", { appId: id, state });
                  }}
                  editHandle={controls}
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
                  editHandle={controls}
                  onContentHeight={onContentHeight}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
