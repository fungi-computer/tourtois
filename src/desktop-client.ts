import { AppError } from "@fungi.computer/agar/errors";
import type { AppStorage } from "@fungi.computer/agar/storage";
import type { WhistleJsonValue } from "@fungi.computer/whistle";
import {
  desktopSnapshotSchema,
  desktopWidgetsSchema,
  type DesktopMethods,
  type DesktopMutation,
  type DesktopSnapshot,
} from "./desktop-api.js";
import {
  desktopArrangeResultSchema,
  type DesktopArrangeResult,
  type DesktopGill,
} from "./desktop-layout.js";

export type DesktopLayoutClient = Readonly<{
  get: () => DesktopSnapshot & {
    widgets: readonly DesktopGill[];
    refreshFailure: Error | null;
  };
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  /** Re-read in the background; a failure shows through `refreshFailure`. */
  invalidate: () => void;
  mutate: (
    method: DesktopMutation,
    input: WhistleJsonValue,
  ) => Promise<DesktopArrangeResult>;
  close: () => void;
}>;

/** Watch invalidations only; the backend owns resolution, catalog and every write. */
export async function createDesktopLayoutClient({
  storage,
  methods,
}: {
  storage: Pick<AppStorage, "watch">;
  methods: DesktopMethods;
}): Promise<DesktopLayoutClient> {
  const watch = await storage.watch("desktop");
  const listeners = new Set<() => void>();
  let snapshot: ReturnType<DesktopLayoutClient["get"]> | undefined;
  let closed = false;
  const isClosed = () => closed;
  let dirty = false;
  let pending: Promise<void> | undefined;
  let retirePending: (() => void) | undefined;
  const publishRefreshFailure = (cause: unknown): void => {
    if (isClosed() || snapshot === undefined) return;
    const previous = snapshot.refreshFailure;
    if (
      previous !== null &&
      (previous === cause ||
        (!(previous instanceof AppError) && previous.cause === cause))
    )
      return;
    snapshot = {
      ...snapshot,
      refreshFailure:
        cause instanceof AppError
          ? cause
          : new Error("Your desktop could not be refreshed.", { cause }),
    };
    for (const notify of listeners) notify();
  };
  const refresh = (): Promise<void> => {
    if (isClosed()) return Promise.resolve();
    dirty = true;
    if (pending) return pending;
    const attempt = { retired: false };
    const isRetired = () => attempt.retired;
    let timer: ReturnType<typeof setTimeout>;
    const interrupted = new Promise<void>((resolve, reject) => {
      retirePending = () => {
        attempt.retired = true;
        resolve();
      };
      // Bound the entire shared refresh, including coalesced invalidations.
      timer = setTimeout(() => {
        attempt.retired = true;
        reject(
          new AppError("Your desktop read timed out. Try refreshing again.", {
            code: "TIMEOUT",
            retryable: true,
          }),
        );
      }, 10_000);
    });
    const reading = (async () => {
      while (dirty && !isClosed() && !isRetired()) {
        dirty = false;
        const [layout, widgets] = await Promise.all([
          methods
            .call("layout.get", "{}")
            .then((value) => desktopSnapshotSchema.parse(value)),
          methods
            .call("widgets.available", "{}")
            .then((value) => desktopWidgetsSchema.parse(value)),
        ]);
        if (isClosed() || isRetired()) return;
        snapshot = {
          ...layout,
          widgets: widgets.widgets,
          refreshFailure: null,
        };
        for (const notify of listeners) notify();
      }
    })();
    pending = Promise.race([reading, interrupted])
      .finally(() => {
        clearTimeout(timer);
        retirePending = undefined;
        pending = undefined;
      })
      .catch((cause: unknown) => {
        publishRefreshFailure(cause);
        throw cause;
      });
    return pending;
  };
  // Handle background failures through the same idempotent state publisher.
  const invalidate = () => {
    void refresh().catch(publishRefreshFailure);
  };
  const unsubscribe = watch.subscribe(invalidate);
  const close = () => {
    closed = true;
    retirePending?.();
    unsubscribe();
    watch.close();
    listeners.clear();
  };
  try {
    await refresh();
  } catch (cause) {
    close();
    throw cause;
  }
  return {
    get: () => {
      if (snapshot === undefined)
        throw new Error("The desktop has not loaded.");
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    invalidate,
    async mutate(method, input) {
      const result = desktopArrangeResultSchema.parse(
        await methods.call(method, JSON.stringify(input)),
      );
      if (result.kind === "accepted" || result.code === "conflict")
        await refresh();
      return result;
    },
    close,
  };
}
