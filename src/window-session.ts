import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AppStorageError, type AppStorage } from "@fungi.computer/agar/storage";
import type { AppDirectoryApp } from "./app-launch.js";
import type { AppLaunchDescriptor } from "./app-windows.js";

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

/** Where setup's chat stands in the desktop, in the desktop's own pixels. */
export type SetupChatPlacement = Readonly<{
  left: number;
  right: number;
  width: number;
}>;

/** Space kept between the chat, a window and the desktop's edge. */
const besideGap = 16;
/** The narrowest column a window can sensibly take beside the chat. */
const besideMinimum = 360;

/** Whether a stored session has anything on screen that a chat could be under. */
function couldCoverChat(session: WindowSession): boolean {
  return session.windows.some((window) => !window.minimized);
}

/**
 * Seat the windows that would cover the chat, the only chat this knows of being
 * the lone widget of an unarranged desktop: they float in the larger free
 * column beside it, sized to fit and never over it, or are minimised in the bar
 * when no column is 360px wide. A tiled session covers it by construction, so
 * it floats. Windows clear of the chat stay as stored. Returns null when
 * nothing covers the chat. The result is for display: the hook never writes it
 * back over the stored session.
 */
export function sessionBesideSetupChat(
  session: WindowSession,
  chat: SetupChatPlacement,
): WindowSession | null {
  // The chat fills the desktop's height, so only horizontal overlap matters.
  const covers = (window: WindowSession["windows"][number]) =>
    !window.minimized &&
    (session.tiled ||
      (window.frame.x < chat.right &&
        window.frame.x + window.frame.width > chat.left));
  if (!session.windows.some(covers)) return null;
  const leftColumn = chat.left - 2 * besideGap;
  const rightColumn = chat.width - chat.right - 2 * besideGap;
  const useRight = rightColumn > leftColumn;
  const width = Math.max(leftColumn, rightColumn);
  const x = useRight ? chat.right + besideGap : besideGap;
  let seated = 0;
  return {
    ...session,
    tiled: false,
    windows: session.windows.map((window) => {
      if (!covers(window)) return window;
      const index = seated++;
      return width >= besideMinimum
        ? {
            ...window,
            frame: {
              x: x + index * 12,
              y: 24 + index * 12,
              width: width - index * 12,
              height: Math.min(window.frame.height, 560),
            },
          }
        : { ...window, minimized: true };
    }),
  };
}

/** Whether two sessions arrange the windows alike, give or take rounding. */
export function sameArrangement(a: WindowSession, b: WindowSession): boolean {
  // Rounding only: a window the person moved differs by far more.
  const near = (x: number, y: number) => Math.abs(x - y) <= 2;
  return (
    a.tiled === b.tiled &&
    a.windows.length === b.windows.length &&
    a.windows.every((window, index) => {
      const other = b.windows[index];
      if (other === undefined) return false;
      return (
        window.surfaceId === other.surfaceId &&
        window.minimized === other.minimized &&
        (window.minimized ||
          (near(window.frame.x, other.frame.x) &&
            near(window.frame.y, other.frame.y) &&
            near(window.frame.width, other.frame.width) &&
            near(window.frame.height, other.frame.height)))
      );
    })
  );
}

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

/**
 * The session to store while the stored windows are still reopening. A reopen
 * waits for each App to get ready, so a save that held back until the restore
 * ended lost whatever the person opened meanwhile if the page reloaded first.
 * Storing the windows not back yet beside the open ones keeps both: stored
 * order first, then the new windows, with open windows at their current frame.
 */
export function sessionWhileRestoring(
  current: WindowSession,
  stored: WindowSession,
): WindowSession {
  const open = new Map(current.windows.map((item) => [item.surfaceId, item]));
  const storedIds = new Set(stored.windows.map((item) => item.surfaceId));
  const merged = [
    ...stored.windows.map((item) => open.get(item.surfaceId) ?? item),
    ...current.windows.filter((item) => !storedIds.has(item.surfaceId)),
  ];
  // Over the limit, the windows not back yet go first; the open ones stay.
  for (let index = 0; merged.length > 16 && index < merged.length;) {
    if (open.has(merged[index]?.surfaceId ?? "")) index += 1;
    else merged.splice(index, 1);
  }
  return windowSessionSchema.parse({
    tiled: current.tiled,
    active: current.active ?? stored.active,
    windows: merged.slice(0, 16),
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

/** The workbench's latest focus request in this page, or null for none yet. */
export type FocusRequest = Readonly<{ windowId: string }> | null;

/**
 * Reopen the stored windows one by one and name the window to focus. The
 * restore runs once per page and waits for the stored session, so the person
 * may open or bring forward an App before it starts or while it runs; their
 * latest choice in this page keeps focus over the stored active window.
 */
export async function restoreWindows<
  Launch extends Readonly<{ windowId: string }>,
>(
  launches: readonly Readonly<{ launch: Launch; minimized: boolean }>[],
  storedActive: string | null,
  manager: Readonly<{
    read: () => Readonly<{
      windows: readonly Readonly<{ windowId: string }>[];
    }>;
    open: (launch: Launch) => Promise<void>;
    minimize: (windowId: string) => Promise<void>;
  }>,
  focusRequest: () => FocusRequest,
): Promise<string | null> {
  const isOpen = (windowId: string) =>
    manager.read().windows.some((item) => item.windowId === windowId);
  for (const { launch, minimized } of launches) {
    if (isOpen(launch.windowId)) continue;
    await manager.open(launch);
    if (minimized) await manager.minimize(launch.windowId);
  }
  const chosen = focusRequest();
  if (chosen !== null && isOpen(chosen.windowId)) return chosen.windowId;
  const active = storedActive && windowIdFor(storedActive);
  return active && isOpen(active) ? active : null;
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

/** The part of an App the restore reads to find its stored window. */
export type RestorableApp = Readonly<{
  surfaceId: string;
  roles: readonly string[];
}>;

export type WindowSessionInput<App extends RestorableApp = AppDirectoryApp> =
  Readonly<{
    storage: AppStorage;
    /** What the restore needs of the window manager. */
    manager: Readonly<{
      read: () => Readonly<{
        windows: readonly Readonly<{ windowId: string }>[];
      }>;
      open: (launch: AppLaunchDescriptor) => Promise<void>;
      minimize: (windowId: string) => Promise<void>;
    }>;
    apps: readonly App[] | undefined;
    launchFor: (app: App) => AppLaunchDescriptor | null;
    snapshot: Omit<WindowSessionSnapshot, "frames">;
    interacting: boolean;
    /** A phone is always tiled, so it neither reads nor overwrites the choice. */
    phone: boolean;
    /**
     * Where the desktop's lone chat stands, null when the desktop is not just
     * that chat; absent until the desktop has said. A restore with windows on
     * screen waits briefly for it, so none comes back covering the chat.
     */
    setupChat?: SetupChatPlacement | null | undefined;
    onTiledChange: ((tiled: boolean) => void) | undefined;
    focusWindow: (windowId: string) => void;
    /** The workbench's latest focus request, mid-restore ones included. */
    focusRequest: () => FocusRequest;
    /** Shown to the person as a toast; the session is never lost silently. */
    onError: (message: string) => void;
  }>;

/**
 * Restore the member's windows once the App directory is known, then keep
 * the stored session current. Frames seed panes as they register.
 */
export function useWindowSession<App extends RestorableApp>(
  input: WindowSessionInput<App>,
) {
  const latest = useRef(input);
  latest.current = input;
  const seeds = useRef(new Map<string, WindowPlacement>());
  const [store] = useState(() => createWindowSessionStore(input.storage));
  const [restored, setRestored] = useState(false);
  // The stored session is known; saving starts here, not when the restore ends.
  const [loaded, setLoaded] = useState(false);
  // The stored windows, until their reopening has finished.
  const pendingStored = useRef<WindowSession | null>(null);
  const started = useRef(false);
  const preferredTiled = useRef(true);
  // The windows as seated beside setup's chat for display, with what is stored.
  // While the arrangement is untouched the stored session is what gets saved.
  const seated = useRef<{ stored: WindowSession; shown: WindowSession } | null>(
    null,
  );
  const ready = input.apps !== undefined;
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const stored = await store.load();
        const chatKnown = () => latest.current.setupChat !== undefined;
        pendingStored.current = stored;
        setLoaded(true);
        // Only a person with something on screen waits (briefly) to learn where
        // setup's chat stands; an empty session, a phone and minimised windows
        // restore at once.
        if (
          stored &&
          couldCoverChat(stored) &&
          !latest.current.phone &&
          !chatKnown()
        )
          for (let waited = 0; waited < 3_000 && !chatKnown(); waited += 50)
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
        const current = latest.current;
        const beside =
          stored && current.setupChat && !current.phone
            ? sessionBesideSetupChat(stored, current.setupChat)
            : null;
        const session = beside ?? stored;
        if (!session || !current.apps) return;
        preferredTiled.current = stored?.tiled ?? session.tiled;
        current.onTiledChange?.(session.tiled);
        const launches = restorableLaunches(
          session,
          current.apps,
          current.launchFor,
        );
        for (const { launch, frame } of launches)
          seeds.current.set(launch.windowId, frame);
        // What is compared with later is only what actually reopened: an App
        // that is no longer available is not a change the person made.
        if (stored && beside) {
          const reopened = new Set(
            launches.map(({ launch }) => launch.windowId),
          );
          seated.current = {
            stored,
            shown: {
              ...beside,
              windows: beside.windows.filter((window) =>
                reopened.has(windowIdFor(window.surfaceId)),
              ),
            },
          };
        }
        const focused = await restoreWindows(
          launches,
          session.active,
          current.manager,
          current.focusRequest,
        );
        if (focused) latest.current.focusWindow(focused);
      } catch (cause) {
        console.error("Open windows could not be restored", cause);
        latest.current.onError("Your open windows could not be restored.");
      } finally {
        pendingStored.current = null;
        setLoaded(true);
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
  // Until the stored windows are back, store them beside the open ones.
  const stored = restored ? null : pendingStored.current;
  // Seating a window beside the chat is display only: until the person changes
  // the arrangement, the session they stored is the one kept.
  const untouched =
    seated.current !== null && sameArrangement(session, seated.current.shown);
  const toSave =
    untouched && seated.current
      ? seated.current.stored
      : stored
        ? sessionWhileRestoring(session, stored)
        : session;
  if (!untouched && restored) seated.current = null;
  const body = JSON.stringify(toSave);
  const pending = useRef(toSave);
  pending.current = toSave;
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || interacting || saved.current === body) return;
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
  }, [body, interacting, loaded, store]);
  return {
    reportFrame,
    seedFrame: (windowId: string): WindowPlacement | undefined =>
      seeds.current.get(windowId),
  };
}
