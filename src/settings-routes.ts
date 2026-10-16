import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";
import type { RouterCore } from "@tanstack/router-core";
import * as z from "zod";
import type { WhistleJsonValue } from "@fungi.computer/whistle";

const appKey = z.string().min(1).max(256);
const connectorId = z.string().min(1).max(260);
const section = z.enum(["permissions", "desktop", "advanced"]);

/** Host requests name a settings destination, never a browser URL. */
export const settingsLocationSchema = z.discriminatedUnion("category", [
  z.strictObject({ category: z.literal("home") }),
  z.strictObject({
    category: z.literal("apps"),
    appKey: appKey.nullable(),
    section,
  }),
  z.strictObject({ category: z.literal("avatar") }),
  z.strictObject({
    category: z.literal("connectors"),
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("list") }),
      z.strictObject({ kind: z.literal("new") }),
      z.strictObject({ kind: z.literal("connector"), connectorId }),
      z.strictObject({ kind: z.literal("agent"), agentId: appKey.nullable() }),
    ]),
  }),
  z.strictObject({ category: z.literal("computers") }),
  z.strictObject({ category: z.literal("keys") }),
  z.strictObject({ category: z.literal("defaults") }),
  z.strictObject({ category: z.literal("channels") }),
  z.strictObject({ category: z.literal("selling"), appId: appKey.nullable() }),
]);
export type SettingsLocation = z.output<typeof settingsLocationSchema>;
export const parseSettingsLocation = (
  value: WhistleJsonValue,
): SettingsLocation => settingsLocationSchema.parse(value);

/** One host's dialog history; settings never replace the Team's browser URL. */
export function createSettingsRouter() {
  // The dialog retains its editors while the router selects their destination.
  const root = createRootRoute({ component: () => null });
  const closed = createRoute({
    getParentRoute: () => root,
    path: "/closed",
    loader: () => null,
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    loader: () => ({ category: "home" }) satisfies SettingsLocation,
  });
  const apps = createRoute({
    getParentRoute: () => root,
    path: "/apps",
    loader: () =>
      ({
        category: "apps",
        appKey: null,
        section: "permissions",
      }) satisfies SettingsLocation,
  });
  const app = createRoute({
    getParentRoute: () => root,
    path: "/apps/$appKey/$section",
    params: { parse: (params) => z.object({ appKey, section }).parse(params) },
    loader: ({ params }) =>
      ({ category: "apps", ...params }) satisfies SettingsLocation,
  });
  const avatar = createRoute({
    getParentRoute: () => root,
    path: "/avatar",
    loader: () => ({ category: "avatar" }) satisfies SettingsLocation,
  });
  const defaults = createRoute({
    getParentRoute: () => root,
    path: "/defaults",
    loader: () => ({ category: "defaults" }) satisfies SettingsLocation,
  });
  const connectors = createRoute({
    getParentRoute: () => root,
    path: "/connectors",
    loader: () =>
      ({
        category: "connectors",
        target: { kind: "list" },
      }) satisfies SettingsLocation,
  });
  const connectorNew = createRoute({
    getParentRoute: () => root,
    path: "/connectors/new",
    loader: () =>
      ({
        category: "connectors",
        target: { kind: "new" },
      }) satisfies SettingsLocation,
  });
  const connector = createRoute({
    getParentRoute: () => root,
    path: "/connectors/$connectorId",
    params: {
      parse: (params) => z.object({ connectorId }).parse(params),
    },
    loader: ({ params }) =>
      ({
        category: "connectors",
        target: { kind: "connector", connectorId: params.connectorId },
      }) satisfies SettingsLocation,
  });
  const connectorAgents = createRoute({
    getParentRoute: () => root,
    path: "/connectors/agents",
    loader: () =>
      ({
        category: "connectors",
        target: { kind: "agent", agentId: null },
      }) satisfies SettingsLocation,
  });
  const connectorAgent = createRoute({
    getParentRoute: () => root,
    path: "/connectors/agents/$agentId",
    params: { parse: (params) => z.object({ agentId: appKey }).parse(params) },
    loader: ({ params }) =>
      ({
        category: "connectors",
        target: { kind: "agent", agentId: params.agentId },
      }) satisfies SettingsLocation,
  });
  const computers = createRoute({
    getParentRoute: () => root,
    path: "/computers",
    loader: () => ({ category: "computers" }) satisfies SettingsLocation,
  });
  const keys = createRoute({
    getParentRoute: () => root,
    path: "/keys",
    loader: () => ({ category: "keys" }) satisfies SettingsLocation,
  });
  const channels = createRoute({
    getParentRoute: () => root,
    path: "/channels",
    loader: () => ({ category: "channels" }) satisfies SettingsLocation,
  });
  const selling = createRoute({
    getParentRoute: () => root,
    path: "/selling",
    loader: () =>
      ({ category: "selling", appId: null }) satisfies SettingsLocation,
  });
  const sellApp = createRoute({
    getParentRoute: () => root,
    path: "/selling/apps/$appId",
    params: { parse: (params) => z.object({ appId: appKey }).parse(params) },
    loader: ({ params }) =>
      ({ category: "selling", appId: params.appId }) satisfies SettingsLocation,
  });
  const routeTree = root.addChildren([
    selling,
    sellApp,
    closed,
    home,
    apps,
    app,
    avatar,
    defaults,
    connectors,
    connectorNew,
    connector,
    connectorAgents,
    connectorAgent,
    computers,
    keys,
    channels,
  ]);
  const router: RouterCore<typeof routeTree, "never", false> = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/closed"] }),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  return router;
}

export function navigateSettings(
  router: ReturnType<typeof createSettingsRouter>,
  location: SettingsLocation | null,
) {
  if (location === null) return router.navigate({ to: "/closed" });
  switch (location.category) {
    case "selling":
      return location.appId === null
        ? router.navigate({ to: "/selling" })
        : router.navigate({
            to: "/selling/apps/$appId",
            params: { appId: location.appId },
          });
    case "home":
      return router.navigate({ to: "/" });
    case "avatar":
      return router.navigate({ to: "/avatar" });
    case "defaults":
      return router.navigate({ to: "/defaults" });
    case "channels":
      return router.navigate({ to: "/channels" });
    case "connectors": {
      const target = location.target;
      if (target.kind === "list") return router.navigate({ to: "/connectors" });
      if (target.kind === "new")
        return router.navigate({ to: "/connectors/new" });
      if (target.kind === "connector")
        return router.navigate({
          to: "/connectors/$connectorId",
          params: { connectorId: target.connectorId },
        });
      return target.agentId === null
        ? router.navigate({ to: "/connectors/agents" })
        : router.navigate({
            to: "/connectors/agents/$agentId",
            params: { agentId: target.agentId },
          });
    }
    case "computers":
      return router.navigate({ to: "/computers" });
    case "keys":
      return router.navigate({ to: "/keys" });
    case "apps":
      return location.appKey === null
        ? router.navigate({ to: "/apps" })
        : router.navigate({
            to: "/apps/$appKey/$section",
            params: { appKey: location.appKey, section: location.section },
          });
  }
}
