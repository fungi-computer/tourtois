import { defineIdFamily } from "@fungi.computer/cairn/id";
import type { AppOpenInput } from "@fungi.computer/agar/apps";
import {
  sameWhistleCommand,
  type WhistleMenuProjection,
  type WhistleSnapshot,
} from "@fungi.computer/whistle";
import { type TourtoisAppSurfaceHost } from "./app-surface.js";
import { AppError } from "@fungi.computer/agar";
import {
  createAppWindowManager,
  type AppLaunchDescriptor,
  type AppWindowManager,
  type AppWindowProjection,
} from "./app-windows.js";
import type { WorkbenchDirectory } from "@fungi.computer/nacre/workbench-directory";
import { appSurfaceCommandKey } from "@fungi.computer/nacre/command-host";

export type AppDirectoryApp = WorkbenchDirectory["apps"][number];

export type AppDirectoryRoles = WorkbenchDirectory["roles"];

/** The Team's effective App for a role when it can be launched now. */
export function appForRole(
  apps: readonly AppDirectoryApp[],
  roles: AppDirectoryRoles,
  role: string,
): AppDirectoryApp | undefined {
  const surfaceId = roles[role]?.surfaceId;
  return surfaceId == null
    ? undefined
    : apps.find(
        (app) =>
          app.surfaceId === surfaceId &&
          app.availability === "available" &&
          app.releaseId !== null &&
          app.surface !== null,
      );
}

/** Project a role intent through the Team's current default, including forks. */
export function launchForRoleIntent(
  apps: readonly AppDirectoryApp[],
  roles: AppDirectoryRoles,
  input: AppOpenInput,
  requestId: string,
  launchFor: (app: AppDirectoryApp) => AppLaunchDescriptor | null,
): AppLaunchDescriptor {
  const recipient =
    "appId" in input
      ? apps.find(
          (app) =>
            app.appId === input.appId &&
            app.availability === "available" &&
            app.releaseId !== null &&
            app.surface !== null,
        )
      : appForRole(apps, roles, input.role);
  if (!recipient)
    throw new Error("The requested App is not available in this Team.");
  const launch = launchFor(recipient);
  if (!launch) throw new Error("The chosen App is unavailable.");
  return {
    ...launch,
    openRequest: { ...input.intent, requestId },
  };
}

export const composeOpenRequests = defineIdFamily({
  family: "tourtois-compose-open-request",
  version: 1,
  kinds: { request: { prefix: "request" } },
});

export type ComputerOption = Readonly<{ computerId: string; name: string }>;

/** Build the owner-issued launch descriptor for one currently available surface. */
export function createAppLaunchDescriptor(
  installation: AppDirectoryApp,
  homeComputerId: string | null,
  origin: string,
  computers: readonly ComputerOption[],
  computersUnavailable = false,
): AppLaunchDescriptor | null {
  if (
    installation.availability !== "available" ||
    installation.surface === null ||
    installation.releaseId === null
  )
    return null;
  const href = new URL(installation.surfacePath, origin);
  href.searchParams.set(
    "teamHasComputers",
    computersUnavailable ? "unknown" : String(computers.length > 0),
  );
  const allowedComputers = computersForApp(installation, computers);
  const attachesToComputer =
    installation.computer !== undefined ||
    installation.declaredCapabilities.some((capability) =>
      capability.startsWith("computer."),
    );
  const selectedComputer =
    allowedComputers.find(
      (computer) => computer.computerId === homeComputerId,
    ) ?? allowedComputers[0];
  if (selectedComputer)
    href.searchParams.set("computerId", selectedComputer.computerId);
  href.searchParams.set(
    "authorityVersion",
    String(installation.authorityVersion),
  );
  href.searchParams.set("releaseId", installation.releaseId);
  href.searchParams.set("surfaceRoute", installation.surface.stableRoute);
  return {
    windowId: "app:" + installation.surfaceId,
    surfaceId: installation.surfaceId,
    installationId: installation.installationId,
    appId: installation.appId,
    releaseId: installation.releaseId,
    title: installation.displayName ?? "App",
    href: href.pathname + href.search,
    openRequest: null,
    roles: installation.roles,
    commands: installation.commands,
    ...(attachesToComputer &&
      !computersUnavailable && {
        computers: allowedComputers.map(({ computerId, name }) => ({
          computerId,
          name,
        })),
      }),
  };
}

/**
 * Attach one window to the Computer the person chose in its status bar,
 * from the window's offered list. Only that window changes; a stale or
 * unoffered choice changes nothing.
 * Resolves `false` when the window already uses that Computer.
 */
export async function attachWindowComputer(
  appWindows: Pick<AppWindowManager, "read" | "update">,
  windowId: string,
  computerId: string,
): Promise<boolean> {
  const open = appWindows
    .read()
    .windows.find((item) => item.windowId === windowId);
  if (
    !open?.launch.computers?.some(
      (computer) => computer.computerId === computerId,
    )
  )
    throw new AppError("That Computer is not offered to this App", {
      code: "CAPABILITY_DENIED",
      retryable: false,
    });
  if (launchComputerId(open.launch.href) === computerId) return false;
  // Derive from the launch committed when the window's queue reaches this
  // change, so a concurrent offer refresh is neither lost nor reverted.
  await appWindows.update(windowId, (latest) => {
    if (
      !latest.computers?.some((computer) => computer.computerId === computerId)
    )
      throw new AppError("That Computer is no longer offered to this App", {
        code: "CAPABILITY_DENIED",
        retryable: false,
      });
    return launchForComputer(latest, computerId);
  });
  return true;
}

/** Whether two launches offer the same Computers, in the same order. */
export function sameOfferedComputers(
  left: AppLaunchDescriptor,
  right: AppLaunchDescriptor,
): boolean {
  if (left.computers === undefined || right.computers === undefined)
    return left.computers === right.computers;
  const next = right.computers;
  return (
    left.computers.length === next.length &&
    left.computers.every((computer, index) => {
      const other = next.at(index);
      return (
        computer.computerId === other?.computerId &&
        computer.name === other.name
      );
    })
  );
}

function computersForApp(
  app: AppDirectoryApp,
  computers: readonly ComputerOption[],
): readonly ComputerOption[] {
  // Standalone context is fixed or owner-fleet, never fabricated Team grants.
  // Only an offered inventory entry can become a window's Computer choice.
  const context = app.computer;
  if (context === "owner-fleet") return computers;
  if (context !== undefined)
    return computers.filter(
      (computer) => computer.computerId === context.computerId,
    );
  const permission = app.computerPermission;
  if (!permission) return [];

  if (
    permission.kind === "all-team-computers" &&
    permission.operations.length > 0
  )
    return computers;

  if (permission.kind !== "selected-computers") return [];
  const allowedIds = new Set(
    permission.computers
      .filter((computer) => computer.operations.length > 0)
      .map((computer) => computer.computerId),
  );
  return computers.filter((computer) => allowedIds.has(computer.computerId));
}

export function launchComputerId(href: string): string | null {
  return new URL(href, "https://tourtois.invalid").searchParams.get(
    "computerId",
  );
}

/** Keep the admitted App identity and point its existing surface at one Computer. */
export function launchForComputer(
  launch: AppLaunchDescriptor,
  computerId: string,
): AppLaunchDescriptor {
  const href = new URL(launch.href, "https://tourtois.invalid");
  href.searchParams.set("computerId", computerId);
  return {
    ...launch,
    href: href.pathname + href.search,
  };
}

/** An editor surface's admitted open-file row, once the App registered it. */
export function findOpenFileCommand(
  snapshot: WhistleSnapshot,
  surfaceId: string,
): WhistleMenuProjection | undefined {
  const key = appSurfaceCommandKey({ surfaceId, commandId: "open-file" });
  return snapshot.menu.find((row) => sameWhistleCommand(row.command, key));
}

/** Find the user's already-open editor by its admitted open-file command. */
export function findOpenFileEditor<
  Window extends Pick<AppWindowProjection, "launch">,
>(windows: readonly Window[], snapshot: WhistleSnapshot): Window | undefined {
  return windows.find(
    (window) =>
      findOpenFileCommand(snapshot, window.launch.surfaceId) !== undefined,
  );
}

/**
 * Resolve once a just-mounted App has registered a declared command: an App
 * window is ready when its host connects, and registers its commands after.
 */
export function waitForSurfaceCommand(
  host: Pick<TourtoisAppSurfaceHost, "subscribe">,
  isRegistered: () => boolean,
): Promise<void> {
  if (isRegistered()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("The App did not register its declared command."));
    }, 10_000);
    const check = () => {
      if (!isRegistered()) return;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    };
    const unsubscribe = host.subscribe(check);
    check();
  });
}

/**
 * Select the Team's Files App for file navigation before it is mounted, or
 * any App that declares it opens files when no Files App handles them.
 */
export function findFileNavigationApp(
  apps: readonly AppDirectoryApp[],
  roles: AppDirectoryRoles,
): AppDirectoryApp | undefined {
  const files = appForRole(apps, roles, "files");
  if (files?.handlers.includes("file.open")) return files;
  return apps.find(
    (app) =>
      app.availability === "available" &&
      app.releaseId !== null &&
      app.surface !== null &&
      app.handlers.includes("file.open"),
  );
}

export async function resolveFileEditorWindow(options: {
  apps: readonly AppDirectoryApp[];
  roles: AppDirectoryRoles;
  appWindows: ReturnType<typeof createAppWindowManager>;
  appSurfaceHost: Pick<TourtoisAppSurfaceHost, "snapshot" | "subscribe">;
  computerId: string;
  computers: readonly ComputerOption[];
  origin: string;
  onPermissionNeeded: (app: AppDirectoryApp) => void;
}): Promise<Readonly<{ launch: AppLaunchDescriptor; opened: boolean }>> {
  const existing = findOpenFileEditor(
    options.appWindows.read().windows,
    options.appSurfaceHost.snapshot(),
  );
  const installation = existing
    ? options.apps.find((app) => app.surfaceId === existing.launch.surfaceId)
    : findFileNavigationApp(options.apps, options.roles);
  if (!installation)
    throw new Error("No file editor is available for this Team.");
  if (
    !computersForApp(installation, options.computers).some(
      (computer) => computer.computerId === options.computerId,
    )
  ) {
    options.onPermissionNeeded(installation);
    throw new Error("The file editor needs permission to use this Computer.");
  }
  if (existing) return { launch: existing.launch, opened: false };

  const candidate = createAppLaunchDescriptor(
    installation,
    options.computerId,
    options.origin,
    options.computers,
  );
  if (!candidate) throw new Error("No file editor is available for this Team.");

  await options.appWindows.open(candidate);
  const mounted = options.appWindows
    .read()
    .windows.find((window) => window.windowId === candidate.windowId);
  const editor = mounted
    ? await waitForSurfaceCommand(
        options.appSurfaceHost,
        () =>
          findOpenFileCommand(
            options.appSurfaceHost.snapshot(),
            mounted.launch.surfaceId,
          ) !== undefined,
      ).then(
        () => mounted,
        () => undefined,
      )
    : undefined;
  if (editor) return { launch: editor.launch, opened: true };

  await options.appWindows.close(candidate.windowId).catch((cause: unknown) => {
    console.error("App workbench operation failed", cause);
    return undefined;
  });
  throw new Error("The configured file editor is unavailable.");
}

export function requireHandledNavigation(
  outcome: Awaited<ReturnType<TourtoisAppSurfaceHost["execute"]>>,
): void {
  if (outcome.status === "handled") return;
  if (outcome.status === "failed") throw new Error(outcome.error.message);
  if (outcome.status === "unavailable") throw new Error(outcome.reason);
  if (outcome.status === "closed") throw new Error("The editor has closed.");
  throw new Error("The editor's open-file command is unavailable.");
}
