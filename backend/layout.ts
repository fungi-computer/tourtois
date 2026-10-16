/** Layout reads and CAS writes against the installation's existing storage owner. */
import * as Schema from "effect/Schema";
import {
  appStorageReadResultSchema,
  appStorageMutationResultSchema,
  type ResolvedAppStorage,
} from "@fungi.computer/agar/storage-wire";
import type { AppStorageWire } from "@fungi.computer/agar/storage";
import {
  appCatalogResponseSchema,
  type AppCatalog,
} from "@fungi.computer/oyster/shell/app-directory";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import {
  desktopLayoutSchema,
  compactDesktopLayout,
  initialDesktopLayout,
  applyDesktopOps,
  validDesktopGillParams,
  type DesktopGill,
  type DesktopArrange,
  type DesktopLayout,
  type DesktopArrangeResult,
} from "../src/desktop-layout.js";
import { tourtoisLaunchers } from "../src/desktop/own-launchers.js";

export type LayoutContext = Readonly<{
  env: {
    APP_STORAGE: Pick<AppStorageWire, "read" | "write" | "reset">;
    APPS: { catalog(input: Record<never, never>): Promise<AppCatalog> };
  };
}>;
const ids = defineIdFamily({
  family: "desktop",
  version: 1,
  kinds: { gill: { prefix: "gill" } },
});
const launcher: DesktopGill = {
  surfaceId: "tourtois",
  gillId: "launcher",
  title: "Launcher",
  sizes: ["S", "M", "L"],
  kind: "launcher",
};
async function catalog(context: LayoutContext) {
  const apps = appCatalogResponseSchema.parse(
    await context.env.APPS.catalog({}),
  );
  const widgets: DesktopGill[] = [
    launcher,
    ...apps.apps.flatMap((app) =>
      app.gills.flatMap((gill) => {
        if (gill.desktop === undefined) return [];
        let widget: DesktopGill = {
          surfaceId: app.surfaceId,
          gillId: gill.id,
          title: gill.title,
          sizes: gill.desktop.sizes,
          kind: "app",
        };
        if (gill.params !== undefined)
          widget = { ...widget, params: gill.params };
        return [widget];
      }),
    ),
  ];
  return {
    apps,
    widgets,
    launcherIds: [
      ...apps.apps.map((app) => `app:${app.surfaceId}`),
      ...tourtoisLaunchers.map((item) => item.id),
    ],
  };
}
export async function widgetsAvailable(context: LayoutContext) {
  return {
    widgets: (await catalog(context)).widgets.map(({ params, ...widget }) => {
      const projection = { ...widget, sizes: [...widget.sizes] };
      if (params === undefined) return projection;
      return { ...projection, params: params.map((param) => ({ ...param })) };
    }),
  };
}
async function read(context: LayoutContext): Promise<ResolvedAppStorage> {
  const result = Schema.decodeUnknownSync(appStorageReadResultSchema)(
    await context.env.APP_STORAGE.read("desktop"),
  );
  if (result.kind === "rejected")
    throw new Error(`Desktop storage read failed: ${result.code}`);
  return result.value;
}
function saved(value: unknown): DesktopLayout | null {
  const parsed = desktopLayoutSchema.safeParse(value);
  if (!parsed.success) return null;
  return compactDesktopLayout(parsed.data);
}
function resolved(
  value: ResolvedAppStorage,
  apps: AppCatalog,
  widgets: readonly DesktopGill[],
) {
  const stored = value.source === "none" ? null : saved(value.value);
  const layout =
    stored ??
    (value.team === null ? null : saved(value.team.value)) ??
    initialDesktopLayout(widgets, apps.roles.inbox?.surfaceId ?? null);
  return {
    layout,
    notice:
      value.source !== "none" && stored === null
        ? "Your saved desktop could not be read. The available default is shown."
        : null,
  };
}
export async function layoutGet(context: LayoutContext) {
  const [value, available] = await Promise.all([
    read(context),
    catalog(context),
  ]);
  const current = resolved(value, available.apps, available.widgets);
  return {
    ...current,
    source: value.source,
    memberRevision: value.member?.revision ?? null,
    teamRevision: value.team?.revision ?? null,
    canWriteTeam: value.canWriteTeam,
  };
}
export type LayoutWrite = Pick<DesktopArrange, "scope" | "basedOn">;
export async function layoutWrite(
  context: LayoutContext,
  input: LayoutWrite,
  edit: DesktopArrange["ops"] | { layout: DesktopLayout },
): Promise<DesktopArrangeResult> {
  const [value, available] = await Promise.all([
    read(context),
    catalog(context),
  ]);
  if (input.scope === "team" && !value.canWriteTeam)
    return { kind: "rejected", code: "owner_required" };
  if (input.basedOn !== (value[input.scope]?.revision ?? null))
    return { kind: "rejected", code: "conflict" };
  const current = resolved(value, available.apps, available.widgets).layout;
  if (
    "layout" in edit &&
    edit.layout.items.some(
      (item) =>
        !validDesktopGillParams(
          item.params,
          available.widgets.find(
            (widget) =>
              widget.surfaceId === item.surfaceId &&
              widget.gillId === item.gillId,
          )?.params,
        ),
    )
  )
    return { kind: "rejected", code: "params_invalid" };
  const transition =
    "layout" in edit
      ? ({
          kind: "accepted",
          layout: compactDesktopLayout(edit.layout),
        } as const)
      : applyDesktopOps(
          current,
          edit,
          available.widgets,
          available.launcherIds,
          () => ids.gill.generate(),
        );
  if (transition.kind === "rejected") return transition;
  let layout = transition.layout;
  if (layout !== null) {
    layout = {
      ...layout,
      launcher: {
        pinned: layout.launcher.pinned.filter((id) =>
          available.launcherIds.includes(id),
        ),
        hidden: layout.launcher.hidden.filter((id) =>
          available.launcherIds.includes(id),
        ),
      },
    };
    const valid = desktopLayoutSchema.safeParse(layout);
    if (!valid.success) return { kind: "rejected", code: "invalid" };
    layout = valid.data;
  }
  const raw =
    layout === null
      ? await context.env.APP_STORAGE.reset({ key: "desktop", ...input })
      : await context.env.APP_STORAGE.write({
          key: "desktop",
          ...input,
          value: layout,
        });
  const result = Schema.decodeUnknownSync(appStorageMutationResultSchema)(raw);
  if (result.kind === "accepted") return { kind: "accepted" };
  switch (result.code) {
    case "invalid":
    case "owner_required":
    case "conflict":
    case "too_large":
    case "quota_exceeded":
      return { kind: "rejected", code: result.code };
    default:
      throw new Error(`Desktop storage update failed: ${result.code}`);
  }
}
