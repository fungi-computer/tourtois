import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AppStorageError, type AppStorage } from "@fungi.computer/agar/storage";
import type { AppDirectoryApp } from "./app-launch.js";
import type { AppLaunchDescriptor, AppWindowManager } from "./app-windows.js";

/** The member's own storage key for the windows they had open. */
export const windowSessionKey = "windows";

const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const windowSessionSchema = z.object({
  tiled: z.boolean(),
  /** The focused window's surface, raised last so it stays on top. */
  active: z.string().nullable(),
  /** Open windows in tiling order, minimized ones included. */
  windows: z
    .array(
      z.object({
        surfaceId: z.string().min(1),
        frame: frameSchema,
        minimized: z.boolean().default(false),
      }),
    )
    .max(16),
});

export type WindowSession = z.infer<typeof windowSessionSchema>;
export type WindowPlacement = z.infer<typeof frameSchema>;

/** What the shell reads from layout and windows to describe the session. */
export type WindowSessionSnapshot = Readonly<{
  tiled: boolean;
  activeWindowId: string | null;
  windows: readonly Readonly<{
    windowId: string;
    surfaceId: string;
    status: string;
  }>[];
  frames: ReadonlyMap<string, WindowPlacement>;
}>;

const windowIdFor = (surfaceId: string) => "app:" + surfaceId;

/** Where a new window floats until the person moves it. */
export const cascade = (index: number): WindowPlacement => ({
  x: 24 + index * 40,
  y: 24 + index * 32,
  width: 600,
  height: 480,
});

/** Pure projection of the live desktop into the stored shape. */
export function windowSessionFrom(
  snapshot: WindowSessionSnapshot,
): WindowSession {
  const windows = snapshot.windows.map((item, index) => ({
    surfaceId: item.surfaceId,
    frame: { ...(snapshot.frames.get(item.windowId) ?? cascade(index)) },
    minimized: item.status === "minimized",
  }));
  const active = snapshot.windows.find(
    (item) => item.windowId === snapshot.activeWindowId,
  );
  return windowSessionSchema.parse({
    tiled: snapshot.tiled,
    active:
      active &&
      windows.some(
        (item) => item.surfaceId === active.surfaceId && !item.minimized,
      )
        ? active.surfaceId
        : null,
    windows: windows.slice(0, 16),
  });
}

/** Launches for the stored windows whose Apps are still installed, in order. */
export function restorableLaunches<
  App extends Readonly<{ surfaceId: string; roles: readonly string[] }>,
  Launch,
>(
  session: WindowSession,
  apps: readonly App[],
  launchFor: (app: App) => Launch | null,
): readonly Readonly<{
  launch: Launch;
  frame: WindowPlacement;
  minimized: boolean;
}>[] {
  return session.windows.flatMap((saved) => {
    const app = apps.find(
      (item) =>
        item.surfaceId === saved.surfaceId && !item.roles.includes("dashboard"),
    );
    const launch = app ? launchFor(app) : null;
    return launch
      ? [{ launch, frame: saved.frame, minimized: saved.minimized }]
      : [];
  });
}

/** Reads and writes the session through the member's storage layer. */
export function createWindowSessionStore(storage: AppStorage) {
  let revision: number | null = null;
  let queue: Promise<void> = Promise.resolve();
  return {
    async load(): Promise<WindowSession | null> {
      const resolved = await storage.read(windowSessionKey);
      revision = resolved.member?.revision ?? null;
      const parsed = windowSessionSchema.safeParse(resolved.member?.value);
      return parsed.success ? parsed.data : null;
    },
    save(session: WindowSession): Promise<void> {
      const attempt = async () => {
        const result = await storage.write({
          key: windowSessionKey,
          scope: "member",
          basedOn: revision,
          value: session,
        });
        revision = result.revision;
      };
      const write = async () => {
        try {
          await attempt();
        } catch (cause) {
          // Another tab saved first. This tab's state is the current one, so
          // take the stored revision and save over it once; anything else is a
          // real failure.
          if (!(cause instanceof AppStorageError) || cause.code !== "conflict")
            throw cause;
          const resolved = await storage.read(windowSessionKey);
          revision = resolved.member?.revision ?? null;
          await attempt();
        }
      };
      // Each save waits for the previous one to settle, then runs; the caller
      // of a failed save receives that failure.
      const saving = queue.then(write, write);
      queue = saving;
      return saving;
    },
  };
}

export type WindowSessionInput = Readonly<{
  storage: AppStorage;
  manager: AppWindowManager;
  apps: readonly AppDirectoryApp[] | undefined;
  launchFor: (app: AppDirectoryApp) => AppLaunchDescriptor | null;
  snapshot: Omit<WindowSessionSnapshot, "frames">;
  interacting: boolean;
  /** A phone is always tiled, so it neither reads nor overwrites the choice. */
  phone: boolean;
  onTiledChange: ((tiled: boolean) => void) | undefined;
  focusWindow: (windowId: string) => void;
  /** Shown to the person as a toast; the session is never lost silently. */
  onError: (message: string) => void;
}>;

/**
 * Restore the member's windows once the App directory is known, then keep
 * the stored session current. Frames seed panes as they register.
 */
export function useWindowSession(input: WindowSessionInput) {
  const latest = useRef(input);
  latest.current = input;
  const seeds = useRef(new Map<string, WindowPlacement>());
  const [store] = useState(() => createWindowSessionStore(input.storage));
  const [restored, setRestored] = useState(false);
  const started = useRef(false);
  const preferredTiled = useRef(true);
  const ready = input.apps !== undefined;
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const session = await store.load();
        const current = latest.current;
        if (!session || !current.apps) return;
        preferredTiled.current = session.tiled;
        current.onTiledChange?.(session.tiled);
        const launches = restorableLaunches(
          session,
          current.apps,
          current.launchFor,
        );
        for (const { launch, frame } of launches)
          seeds.current.set(launch.windowId, frame);
        for (const { launch, minimized } of launches) {
          if (
            current.manager
              .read()
              .windows.some((item) => item.windowId === launch.windowId)
          )
            continue;
          await current.manager.open(launch);
          if (minimized) await current.manager.minimize(launch.windowId);
        }
        const active = session.active && windowIdFor(session.active);
        if (
          active &&
          current.manager.read().windows.some((w) => w.windowId === active)
        )
          latest.current.focusWindow(active);
      } catch (cause) {
        console.error("Open windows could not be restored", cause);
        latest.current.onError("Your open windows could not be restored.");
      } finally {
        setRestored(true);
      }
    })();
  }, [ready, store]);
  const { snapshot, interacting, phone } = input;
  // Where each window floats: restored positions, then whatever panes report.
  const [reported, setReported] = useState<
    ReadonlyMap<string, WindowPlacement>
  >(new Map());
  const reportFrame = useCallback(
    (windowId: string, frame: WindowPlacement) => {
      setReported((current) => {
        const known = current.get(windowId);
        if (
          known?.x === frame.x &&
          known.y === frame.y &&
          known.width === frame.width &&
          known.height === frame.height
        )
          return current;
        return new Map(current).set(windowId, frame);
      });
    },
    [],
  );
  const session = windowSessionFrom({
    ...snapshot,
    frames: new Map([...seeds.current, ...reported]),
    tiled: phone ? preferredTiled.current : snapshot.tiled,
  });
  const body = JSON.stringify(session);
  const pending = useRef(session);
  pending.current = session;
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (!restored || interacting || saved.current === body) return;
    const timer = setTimeout(() => {
      saved.current = body;
      void store.save(pending.current).catch((cause: unknown) => {
        saved.current = null;
        console.error("Open windows were not saved", cause);
        latest.current.onError("Your open windows could not be saved.");
      });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [body, interacting, restored, store]);
  return {
    reportFrame,
    seedFrame: (windowId: string): WindowPlacement | undefined =>
      seeds.current.get(windowId),
  };
}
