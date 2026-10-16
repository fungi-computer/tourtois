import * as z from "zod";
import type { appMethods } from "@fungi.computer/agar/backend";
import { desktopArrangeSchema, desktopLayoutSchema } from "./desktop-layout.js";
import * as Schema from "effect/Schema";
import { appGillParamsSchema } from "@fungi.computer/gills";

export const desktopSnapshotSchema = z.strictObject({
  layout: desktopLayoutSchema,
  source: z.enum(["member", "team", "none"]),
  memberRevision: desktopArrangeSchema.shape.basedOn,
  teamRevision: desktopArrangeSchema.shape.basedOn,
  canWriteTeam: z.boolean(),
  notice: z.string().nullable(),
});
export const desktopWidgetsSchema = z.strictObject({
  widgets: z.array(
    z.strictObject({
      surfaceId: z.string().min(1),
      gillId: z.string().min(1),
      title: z.string(),
      sizes: z.array(z.enum(["S", "M", "L"])),
      kind: z.enum(["app", "launcher"]),
      params: z
        .array(
          z.strictObject({
            key: z.string(),
            label: z.string(),
            kind: z.enum(["computer", "repository", "branch"]),
            required: z.boolean(),
            options: z.string().optional(),
          }),
        )
        .refine((value): boolean => Schema.is(appGillParamsSchema)(value))
        .optional(),
    }),
  ),
});

export type DesktopMethods = z.output<typeof appMethods.schema>;
export type DesktopSnapshot = z.output<typeof desktopSnapshotSchema>;
export type DesktopMutation =
  | "layout.place"
  | "layout.move"
  | "layout.resize"
  | "layout.remove"
  | "layout.launcher"
  | "layout.set"
  | "layout.reset";
