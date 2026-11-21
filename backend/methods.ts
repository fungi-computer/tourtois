/** One typed API for the dashboard UI and attached Agents, without a browser writer. */
import * as z from "zod";
import {
  defineAppBackend,
  defineAppMethod,
} from "@fungi.computer/agar/backend-definition";
import {
  desktopArrangeSchema,
  desktopArrangeResultSchema,
  desktopLayoutSchema,
  type DesktopArrange,
} from "../src/desktop-layout.js";
import {
  layoutCheckPlace,
  placementCheckSchema,
  layoutGet,
  layoutWrite,
  widgetsAvailable,
  type LayoutContext,
} from "./layout.js";

import {
  desktopSnapshotSchema,
  desktopWidgetsSchema,
} from "../src/desktop-api.js";

const empty = z.strictObject({});
const mutation = {
  scope: desktopArrangeSchema.shape.scope,
  basedOn: desktopArrangeSchema.shape.basedOn,
};
const ops = desktopArrangeSchema.shape.ops.element.options;
const requires = ["app.storage", "team.workbenchHost"] as const;
export const appBackend = defineAppBackend<LayoutContext>({
  methods: {
    "layout.get": defineAppMethod({
      description: "Read the resolved desktop and layer revisions.",
      effect: "read",
      requires,
      input: empty,
      output: desktopSnapshotSchema,
      handler: (_input, context) => layoutGet(context),
    }),
    "widgets.available": defineAppMethod({
      description:
        "List available declared desktop widgets and the Tourtois launcher.",
      effect: "read",
      requires: ["team.workbenchHost"],
      input: empty,
      output: desktopWidgetsSchema,
      handler: (_input, context) => widgetsAvailable(context),
    }),
    "layout.checkPlace": defineAppMethod({
      description:
        "Check whether a widget can be placed, before anyone is asked.",
      effect: "read",
      hidden: true,
      requires,
      input: ops[0].omit({ kind: true }).extend(mutation),
      output: placementCheckSchema,
      handler: (input, context) => layoutCheckPlace(context, input),
    }),
    "layout.place": defineAppMethod({
      description: "Add a widget to your dashboard.",
      precheck: "layout.checkPlace",
      effect: "write",
      label: "Add a widget to your dashboard",
      requires,
      input: ops[0].omit({ kind: true }).extend(mutation),
      output: desktopArrangeResultSchema,
      handler: (input, context) => {
        const op: DesktopArrange["ops"][number] = {
          kind: "add",
          surfaceId: input.surfaceId,
          gillId: input.gillId,
          size: input.size,
        };
        if (input.at !== undefined) op.at = input.at;
        if (input.params !== undefined) op.params = input.params;
        return layoutWrite(
          context,
          { scope: input.scope, basedOn: input.basedOn },
          [op],
        );
      },
    }),
    "layout.move": defineAppMethod({
      description: "Move an item on your dashboard.",
      effect: "write",
      label: "Move a dashboard item",
      requires,
      input: ops[1].omit({ kind: true }).extend(mutation),
      output: desktopArrangeResultSchema,
      handler: (input, context) =>
        layoutWrite(context, { scope: input.scope, basedOn: input.basedOn }, [
          { kind: "move", id: input.id, to: input.to },
        ]),
    }),
    "layout.resize": defineAppMethod({
      description: "Resize a widget on your dashboard.",
      effect: "write",
      label: "Resize a dashboard widget",
      requires,
      input: ops[2].omit({ kind: true }).extend(mutation),
      output: desktopArrangeResultSchema,
      handler: (input, context) =>
        layoutWrite(context, { scope: input.scope, basedOn: input.basedOn }, [
          { kind: "resize", id: input.id, size: input.size },
        ]),
    }),
    "layout.remove": defineAppMethod({
      description: "Remove an item from your dashboard.",
      effect: "write",
      label: "Remove a dashboard item",
      requires,
      input: ops[3].omit({ kind: true }).extend(mutation),
      output: desktopArrangeResultSchema,
      handler: (input, context) =>
        layoutWrite(context, { scope: input.scope, basedOn: input.basedOn }, [
          { kind: "remove", id: input.id },
        ]),
    }),
    "layout.launcher": defineAppMethod({
      description: "Show, pin or hide a launcher on your dashboard.",
      effect: "write",
      label: "Change your launcher",
      requires,
      input: z.strictObject({
        ...mutation,
        appId: ops[5].shape.id,
        state: ops[5].shape.state,
      }),
      output: desktopArrangeResultSchema,
      handler: (input, context) =>
        layoutWrite(context, { scope: input.scope, basedOn: input.basedOn }, [
          { kind: "launcher", id: input.appId, state: input.state },
        ]),
    }),
    "layout.set": defineAppMethod({
      description: "Replace your whole dashboard layout.",
      effect: "write",
      label: "Replace your dashboard layout",
      requires,
      input: z.strictObject({ ...mutation, layout: desktopLayoutSchema }),
      output: desktopArrangeResultSchema,
      handler: (input, context) =>
        layoutWrite(
          context,
          { scope: input.scope, basedOn: input.basedOn },
          { layout: input.layout },
        ),
    }),
    "layout.reset": defineAppMethod({
      description: "Reset your dashboard to the default layout.",
      effect: "write",
      label: "Reset your dashboard layout",
      requires,
      input: z.strictObject(mutation),
      output: desktopArrangeResultSchema,
      handler: (input, context) =>
        layoutWrite(context, input, [{ kind: "reset" }]),
    }),
  },
});
