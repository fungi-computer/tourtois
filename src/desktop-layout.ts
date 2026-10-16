import { z } from "zod";
import {
  applyBentoOps,
  arrangeBento,
  type BentoPlacement,
  type BentoOp,
} from "@fungi.computer/maosaico/bento";
import {
  gillParamsSchema,
  type AppGillDesktopSize,
  type AppGillParam,
} from "@fungi.computer/gills";
import * as Schema from "effect/Schema";

/** Stored placement values use the maintained Gill grammar. */
const desktopGillParamsSchema = z
  .record(z.string().min(1).max(64), z.string().max(256))
  .refine((value): boolean => Schema.is(gillParamsSchema)(value));

const identity = z.string().min(1).max(513);
const cell = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 2);
const size = z.enum(["S", "M", "L"]);
const launcherIds = z
  .array(identity)
  .max(128)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "App identities must be unique",
  );
const uniqueIds = (items: readonly { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;
export const desktopLayoutSchema = z.strictObject({
  version: z.literal(1),
  items: z
    .array(
      z.strictObject({
        id: identity,
        surfaceId: identity,
        gillId: identity,
        size,
        col: cell.max(3),
        row: cell.max(47),
        params: desktopGillParamsSchema.exactOptional(),
      }),
    )
    .max(24)
    .refine(uniqueIds, "Gill identities must be unique"),
  launcher: z
    .strictObject({ pinned: launcherIds, hidden: launcherIds })
    .refine(
      (value) => value.pinned.every((id) => !value.hidden.includes(id)),
      "Pinned Apps cannot be hidden",
    ),
});
export type DesktopLayout = z.output<typeof desktopLayoutSchema>;
export type DesktopGill = Readonly<{
  surfaceId: string;
  gillId: string;
  title: string;
  sizes: readonly AppGillDesktopSize[];
  kind: "app" | "launcher";
  params?: readonly AppGillParam[] | undefined;
}>;
export const desktopArrangeSchema = z.strictObject({
  scope: z.enum(["member", "team"]),
  basedOn: z.number().int().positive().nullable(),
  ops: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("add"),
          surfaceId: identity,
          gillId: identity,
          size,
          params: desktopGillParamsSchema.exactOptional(),
          at: z
            .strictObject({ col: cell.max(3), row: cell.max(47) })
            .optional(),
        }),
        z.strictObject({
          kind: z.literal("move"),
          id: identity,
          to: z.strictObject({ col: cell.max(3), row: cell.max(47) }),
        }),
        z.strictObject({ kind: z.literal("resize"), id: identity, size }),
        z.strictObject({ kind: z.literal("remove"), id: identity }),
        z.strictObject({ kind: z.literal("reset") }),
        z.strictObject({
          kind: z.literal("launcher"),
          id: identity,
          state: z.enum(["Shown", "Pinned", "Hidden"]),
        }),
      ]),
    )
    .max(24),
});
export type DesktopArrange = z.output<typeof desktopArrangeSchema>;
export const desktopArrangeResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("accepted") }),
  z.strictObject({
    kind: z.literal("rejected"),
    code: z.enum([
      "invalid",
      "owner_required",
      "unknown_gill",
      "unknown_app",
      "size_not_allowed",
      "unknown_item",
      "too_many",
      "conflict",
      "too_large",
      "quota_exceeded",
      "params_invalid",
    ]),
  }),
]);
export type DesktopArrangeResult = z.output<typeof desktopArrangeResultSchema>;
/** Only the selected Gill's declared keys may be persisted. */
export function validDesktopGillParams(
  params: Readonly<Record<string, string>> | undefined,
  declared: readonly AppGillParam[] = [],
): boolean {
  const values = params ?? {};
  return (
    Object.keys(values).every((key) =>
      declared.some((param) => param.key === key),
    ) &&
    declared.every(
      (param) =>
        !param.required ||
        (Object.hasOwn(values, param.key) && Boolean(values[param.key])),
    )
  );
}
export function desktopPlacements(
  layout: DesktopLayout,
): readonly BentoPlacement[] {
  return layout.items.map((item) => ({
    id: item.id,
    col: item.col,
    row: item.row,
    w: item.size === "S" ? 1 : 2,
    h: item.size === "L" ? 2 : 1,
  }));
}
export function compactDesktopLayout(layout: DesktopLayout): DesktopLayout {
  const cells = arrangeBento(desktopPlacements(layout), 4);
  return {
    ...layout,
    items: layout.items.map((item) => {
      const placement = cells.find((position) => position.id === item.id);
      return {
        ...item,
        col: placement?.col ?? item.col,
        row: placement?.row ?? item.row,
      };
    }),
  };
}
export function availableDesktopLayout(
  layout: DesktopLayout,
  catalog: readonly DesktopGill[],
): DesktopLayout {
  return {
    ...layout,
    items: layout.items.filter((item) =>
      catalog.some(
        (gill) =>
          gill.surfaceId === item.surfaceId &&
          gill.gillId === item.gillId &&
          gill.sizes.includes(item.size),
      ),
    ),
  };
}
export function initialDesktopLayout(
  catalog: readonly DesktopGill[],
  inboxSurfaceId: string | null,
): DesktopLayout {
  const inbox = catalog.find(
    (gill) =>
      gill.kind === "app" &&
      gill.surfaceId === inboxSurfaceId &&
      gill.sizes.includes("L"),
  );
  return {
    version: 1,
    items: [
      ...(inbox
        ? [
            {
              id: "inbox",
              surfaceId: inbox.surfaceId,
              gillId: inbox.gillId,
              size: "L",
              col: 0,
              row: 0,
            } satisfies DesktopLayout["items"][number],
          ]
        : []),
      {
        id: "launcher",
        surfaceId: "tourtois",
        gillId: "launcher",
        size: "M",
        col: inbox ? 2 : 0,
        row: 0,
      },
    ],
    launcher: { pinned: [], hidden: [] },
  };
}

/** Apply one atomic operation batch without reading or writing storage. */
export function applyDesktopOps(
  current: DesktopLayout,
  ops: DesktopArrange["ops"],
  catalog: readonly DesktopGill[],
  launchableAppIds: readonly string[],
  createId: () => string,
):
  | { kind: "accepted"; layout: DesktopLayout | null }
  | Extract<DesktopArrangeResult, { kind: "rejected" }> {
  let layout = current;
  for (const op of ops) {
    if (op.kind === "reset") {
      if (ops.length !== 1) return { kind: "rejected", code: "invalid" };
      continue;
    }
    if (op.kind === "launcher") {
      if (!launchableAppIds.includes(op.id))
        return { kind: "rejected", code: "unknown_app" };
      layout = {
        ...layout,
        launcher: {
          pinned: [
            ...layout.launcher.pinned.filter((id) => id !== op.id),
            ...(op.state === "Pinned" ? [op.id] : []),
          ],
          hidden: [
            ...layout.launcher.hidden.filter((id) => id !== op.id),
            ...(op.state === "Hidden" ? [op.id] : []),
          ],
        },
      };
      continue;
    }
    if (op.kind === "add") {
      const gill = catalog.find(
        (entry) =>
          entry.surfaceId === op.surfaceId && entry.gillId === op.gillId,
      );
      if (!gill) return { kind: "rejected", code: "unknown_gill" };
      if (!gill.sizes.includes(op.size))
        return { kind: "rejected", code: "size_not_allowed" };
      if (!validDesktopGillParams(op.params, gill.params))
        return { kind: "rejected", code: "params_invalid" };
      if (layout.items.length >= 24)
        return { kind: "rejected", code: "too_many" };
      const item: DesktopLayout["items"][number] = {
        id: createId(),
        surfaceId: op.surfaceId,
        gillId: op.gillId,
        size: op.size,
        col: op.at?.col ?? 0,
        row: op.at?.row ?? 0,
      };
      if (op.params !== undefined) item.params = op.params;
      layout = compactDesktopLayout({
        ...layout,
        items: [...layout.items, item],
      });
      continue;
    }
    const item = layout.items.find((entry) => entry.id === op.id);
    if (!item) return { kind: "rejected", code: "unknown_item" };
    if (op.kind === "remove") {
      layout = compactDesktopLayout({
        ...layout,
        items: layout.items.filter((entry) => entry.id !== op.id),
      });
      continue;
    }
    if (op.kind === "resize") {
      const gill = catalog.find(
        (entry) =>
          entry.surfaceId === item.surfaceId && entry.gillId === item.gillId,
      );
      if (!gill?.sizes.includes(op.size))
        return { kind: "rejected", code: "size_not_allowed" };
    }
    const cells = applyBentoOps(
      desktopPlacements(layout),
      [
        op.kind === "move"
          ? { kind: "move", id: op.id, col: op.to.col, row: op.to.row }
          : {
              kind: "resize",
              id: op.id,
              w: op.size === "S" ? 1 : 2,
              h: op.size === "L" ? 2 : 1,
            },
      ],
      4,
    );
    layout = {
      ...layout,
      items: layout.items.map((entry) => {
        const position = cells.find((cell) => cell.id === entry.id);
        return {
          ...entry,
          size:
            op.kind === "resize" && entry.id === op.id ? op.size : entry.size,
          col: position?.col ?? entry.col,
          row: position?.row ?? entry.row,
        };
      }),
    };
  }
  const parsed = desktopLayoutSchema.safeParse(layout);
  if (!parsed.success) return { kind: "rejected", code: "invalid" };
  return {
    kind: "accepted",
    layout: ops[0]?.kind === "reset" ? null : parsed.data,
  };
}

/** Responsive cells are a projection; only the relative intent reaches the wide layout. */
export function desktopBentoIntent(
  layout: DesktopLayout,
  projected: readonly BentoPlacement[],
  op: BentoOp,
): DesktopArrange["ops"][number] | null {
  const item = layout.items.find((item) => item.id === op.id);
  const shown = projected.find((item) => item.id === op.id);
  if (!item || !shown) return null;
  if (op.kind === "resize")
    return {
      kind: "resize",
      id: op.id,
      size: op.h >= 2 ? "L" : op.w >= 2 ? "M" : "S",
    };
  // A phone row crossing is an ordering intent between tiles. Translate it to
  // the neighbour's canonical cell; writing the phone cell would erase the wide layout.
  const reflowed = projected.some((cell) => {
    const canonical = layout.items.find((item) => item.id === cell.id);
    return (
      canonical && (canonical.col !== cell.col || canonical.row !== cell.row)
    );
  });
  if (reflowed && op.row !== shown.row) {
    const neighbours = projected
      .filter(
        (other) =>
          other.id !== op.id &&
          op.col < other.col + other.w &&
          op.col + shown.w > other.col &&
          op.row < other.row + other.h &&
          op.row + shown.h > other.row,
      )
      .sort(
        (a, b) => Math.abs(a.row - shown.row) - Math.abs(b.row - shown.row),
      );
    const neighbour = neighbours[0];
    const canonical = layout.items.find((item) => item.id === neighbour?.id);
    if (canonical && neighbour)
      return {
        kind: "move",
        id: op.id,
        to: {
          col: canonical.col,
          row:
            op.row < shown.row
              ? canonical.row
              : canonical.row + Math.max(1, neighbour.h - shown.h),
        },
      };
  }
  return {
    kind: "move",
    id: op.id,
    to: {
      col: Math.max(0, Math.min(3, item.col + op.col - shown.col)),
      row: Math.max(0, item.row + op.row - shown.row),
    },
  };
}
