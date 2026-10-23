import {
  AppStorageError,
  type AppStorage,
  type AppStorageResult,
} from "@fungi.computer/agar/storage";
import type {
  AppCatalog,
  AppDirectory,
} from "@fungi.computer/nacre/app-directory";
import { parseJsonValue } from "@fungi.computer/whistle/wire";
import { appBackend } from "../backend/methods.js";
import type { DesktopMethods } from "../src/desktop-api.js";

/** Exercise the real Tourtois methods with faithful host-owned storage/catalog ports. */
export function createDesktopMethodsFixture(
  storage: AppStorage,
  catalog: () => AppCatalog,
): DesktopMethods {
  const reply = async <A>(
    body: () => Promise<A>,
  ): Promise<AppStorageResult<A>> => {
    try {
      return { kind: "accepted", value: await body() };
    } catch (cause) {
      if (cause instanceof AppStorageError)
        return { kind: "rejected", code: cause.code };
      throw cause;
    }
  };
  const context = {
    env: {
      APP_STORAGE: {
        read: (key: string) => reply(() => storage.read(key)),
        write: (input: Parameters<AppStorage["write"]>[0]) =>
          reply(() => storage.write(input)),
        reset: (input: Parameters<AppStorage["reset"]>[0]) =>
          reply(() => storage.reset(input)),
      },
      APPS: { catalog: () => Promise.resolve(catalog()) },
    },
  };
  return {
    call: (method, input) =>
      appBackend.call(method, parseJsonValue(JSON.parse(input)), context, {
        computerId: null,
        actor: { kind: "member", memberId: "fixture-owner" },
      }),
  };
}

export function desktopCatalogFixture(
  apps: readonly Pick<
    AppDirectory["apps"][number],
    "appId" | "surfaceId" | "displayName" | "gills"
  >[],
  roles: AppCatalog["roles"],
): AppCatalog {
  const admittedRoles: AppCatalog["roles"] = {};
  if (roles.inbox !== undefined) admittedRoles.inbox = roles.inbox;
  return {
    apps: apps.map((app) => {
      const entry: AppCatalog["apps"][number] = {
        appId: app.appId,
        surfaceId: app.surfaceId,
        gills: app.gills.map((gill) => {
          const item: AppCatalog["apps"][number]["gills"][number] = {
            id: gill.id,
            title: gill.title,
          };
          if (gill.desktop !== undefined)
            item.desktop = { sizes: [...gill.desktop.sizes] };
          if (gill.params !== undefined)
            item.params = gill.params.map((param) => ({ ...param }));
          return item;
        }),
      };
      if (app.displayName !== undefined) entry.displayName = app.displayName;
      return entry;
    }),
    roles: admittedRoles,
  };
}
