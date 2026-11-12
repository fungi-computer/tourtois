import { z } from "zod";
import {
  AppStorageError,
  type AppStorage,
  type AppStorageWatch,
  type ResolvedAppStorage,
} from "@fungi.computer/agar/storage";

const storedLayer = z.object({ value: z.json(), revision: z.number() });

/** Faithful AppStorage seam: member resolution, owner admission, revision CAS and notifications. */
export function createDesktopStorageFixture({
  canWriteTeam = true,
  team = null,
  member = null,
  persist,
}: Partial<Pick<ResolvedAppStorage, "canWriteTeam" | "team" | "member">> & {
  persist?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
} = {}): AppStorage {
  type Layer = ResolvedAppStorage["team"];
  const layers = new Map<string, { team: Layer; member: Layer }>([
    ["desktop", { team, member }],
  ]);
  // A browser proof that reloads the page passes the tab's session storage;
  // the real store outlives a reload, so this keeps the windows key across it.
  const durable = "tourtois-fixture:windows";
  const saved = persist?.getItem(durable) ?? null;
  if (saved !== null)
    layers.set("windows", {
      team: null,
      member: storedLayer.parse(JSON.parse(saved)),
    });
  let revision = Math.max(team?.revision ?? 0, member?.revision ?? 0);
  const listeners = new Map<string, Set<(value: ResolvedAppStorage) => void>>();
  const layersOf = (key: string) => {
    const found = layers.get(key) ?? { team: null, member: null };
    layers.set(key, found);
    return found;
  };
  const snapshot = (key: string): ResolvedAppStorage => {
    const { team: teamLayer, member: memberLayer } = layersOf(key);
    return {
      value: memberLayer?.value ?? teamLayer?.value ?? null,
      source: memberLayer ? "member" : teamLayer ? "team" : "none",
      team: teamLayer,
      member: memberLayer,
      canWriteTeam,
    };
  };
  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) listener(snapshot(key));
  };
  const admit = (
    key: string,
    scope: "member" | "team",
    basedOn: number | null,
  ) => {
    if (scope === "team" && !canWriteTeam)
      throw new AppStorageError("owner_required");
    if (layersOf(key)[scope]?.revision !== (basedOn ?? undefined))
      throw new AppStorageError("conflict");
  };
  return {
    read: (key) => Promise.resolve(snapshot(key)),
    write: ({ key, scope, basedOn, value }) =>
      Promise.resolve().then(() => {
        admit(key, scope, basedOn);
        layersOf(key)[scope] = { value, revision: ++revision };
        if (key === "windows" && scope === "member")
          persist?.setItem(durable, JSON.stringify(layersOf(key).member));
        notify(key);
        return { revision };
      }),
    reset: ({ key, scope, basedOn }) =>
      Promise.resolve().then(() => {
        admit(key, scope, basedOn);
        layersOf(key)[scope] = null;
        notify(key);
        return { revision: ++revision };
      }),
    watch: (key): Promise<AppStorageWatch> => {
      const subscriptions = new Set<(value: ResolvedAppStorage) => void>();
      const keyListeners = listeners.get(key) ?? new Set();
      listeners.set(key, keyListeners);
      const close = () => {
        for (const listener of subscriptions) keyListeners.delete(listener);
        subscriptions.clear();
      };
      return Promise.resolve({
        get: () => snapshot(key),
        subscribe: (listener) => {
          subscriptions.add(listener);
          keyListeners.add(listener);
          return () => {
            subscriptions.delete(listener);
            keyListeners.delete(listener);
          };
        },
        close,
        [Symbol.dispose]: close,
      });
    },
  };
}
