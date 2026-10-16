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
  let teamLayer = team;
  let memberLayer = member;
  let revision = Math.max(team?.revision ?? 0, member?.revision ?? 0);
  const listeners = new Set<(value: ResolvedAppStorage) => void>();
  const snapshot = (): ResolvedAppStorage => ({
    value: memberLayer?.value ?? teamLayer?.value ?? null,
    source: memberLayer ? "member" : teamLayer ? "team" : "none",
    team: teamLayer,
    member: memberLayer,
    canWriteTeam,
  });
  const admit = (scope: "member" | "team", basedOn: number | null) => {
    if (scope === "team" && !canWriteTeam)
      throw new AppStorageError("owner_required");
    if (
      (scope === "team" ? teamLayer : memberLayer)?.revision !==
      (basedOn ?? undefined)
    )
      throw new AppStorageError("conflict");
  };
  return {
    read: () => Promise.resolve(snapshot()),
    write: ({ scope, basedOn, value }) =>
      Promise.resolve().then(() => {
        admit(scope, basedOn);
        const layer = { value, revision: ++revision };
        if (scope === "team") teamLayer = layer;
        else memberLayer = layer;
        for (const notify of listeners) notify(snapshot());
        return { revision };
      }),
    reset: ({ scope, basedOn }) =>
      Promise.resolve().then(() => {
        admit(scope, basedOn);
        if (scope === "team") teamLayer = null;
        else memberLayer = null;
        for (const notify of listeners) notify(snapshot());
        return { revision: ++revision };
      }),
    watch: (): Promise<AppStorageWatch> => {
      const subscriptions = new Set<(value: ResolvedAppStorage) => void>();
      const close = () => {
        for (const notify of subscriptions) listeners.delete(notify);
        subscriptions.clear();
      };
      return Promise.resolve({
        get: snapshot,
        subscribe: (notify) => {
          subscriptions.add(notify);
          listeners.add(notify);
          return () => {
            subscriptions.delete(notify);
            listeners.delete(notify);
          };
        },
        close,
        [Symbol.dispose]: close,
      });
    },
  };
}
