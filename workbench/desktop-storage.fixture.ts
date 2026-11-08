import {
  AppStorageError,
  type AppStorage,
  type AppStorageWatch,
  type ResolvedAppStorage,
} from "@fungi.computer/agar/storage";

/** Faithful AppStorage seam: member resolution, owner admission, revision CAS and notifications. */
export function createDesktopStorageFixture({
  canWriteTeam = true,
  team = null,
  member = null,
}: Partial<
  Pick<ResolvedAppStorage, "canWriteTeam" | "team" | "member">
> = {}): AppStorage {
  type Layer = ResolvedAppStorage["team"];
  const layers = new Map<string, { team: Layer; member: Layer }>([
    ["desktop", { team, member }],
  ]);
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
