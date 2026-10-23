import type { AppWindowManager, AppLaunchDescriptor } from "./app-windows.js";
import { sameOfferedComputers } from "./app-launch.js";

export type AppWindowReconciliationTrigger =
  | Readonly<{ kind: "background-directory-update" }>
  | Readonly<{ kind: "selection-changed" }>;

/** Replace open windows when the owner-issued App directory changes authority. */
export async function reconcileAppDirectory<A extends { surfaceId: string }>(
  appWindows: AppWindowManager,
  apps: readonly A[],
  launchFor: (
    app: A,
    currentLaunch?: AppLaunchDescriptor,
  ) => AppLaunchDescriptor | null,
  onFailure: (action: "close" | "replace") => void,
): Promise<void> {
  await Promise.all(
    appWindows.read().windows.map(async (open) => {
      await reconcileAppWindowFromDirectory(
        appWindows,
        open.launch,
        apps,
        launchFor,
        { kind: "background-directory-update" },
        onFailure,
      );
    }),
  );
}

/** Refresh one stale mount and report whether its old generation was retired. */
export async function reconcileAppWindowFromDirectory<
  A extends { surfaceId: string },
>(
  appWindows: AppWindowManager,
  staleLaunch: AppLaunchDescriptor,
  apps: readonly A[],
  launchFor: (
    app: A,
    currentLaunch?: AppLaunchDescriptor,
  ) => AppLaunchDescriptor | null,
  trigger: AppWindowReconciliationTrigger,
  onFailure: (action: "close" | "replace") => void,
): Promise<boolean> {
  const current = appWindows
    .read()
    .windows.find((window) => window.windowId === staleLaunch.windowId);
  if (
    !current?.launch ||
    appLaunchRequiresReplacement(staleLaunch, current.launch)
  )
    return true;

  const app = apps.find(
    (candidate) => candidate.surfaceId === staleLaunch.surfaceId,
  );
  const next = app ? launchFor(app, current.launch) : null;
  if (
    next &&
    !(trigger.kind === "selection-changed"
      ? appLaunchRequiresReplacement(current.launch, next)
      : appLaunchRequiresDirectoryUpdate(current.launch, next))
  ) {
    // The same mount keeps its iframe; only the Computers its status bar
    // offers follow the Team's current grants and names. An unreadable
    // inventory offers nothing new, so the window keeps its last offer.
    const offered = next.computers;
    if (offered !== undefined && !sameOfferedComputers(current.launch, next))
      // Only the offer changes, applied to the launch committed when the
      // queue reaches it: a Computer switch queued ahead of it stands.
      await appWindows
        .update(current.windowId, (latest) => ({
          ...latest,
          computers: offered,
        }))
        .catch((cause: unknown) => {
          console.error("App Computer offer refresh failed", cause);
        });
    return false;
  }

  const generation = current.generation;
  try {
    if (next) await appWindows.replace(current.windowId, next);
    else await appWindows.close(current.windowId);
  } catch (cause) {
    console.error("App directory reconciliation failed", cause);

    onFailure(next ? "replace" : "close");
    return false;
  }

  const after = appWindows
    .read()
    .windows.find((window) => window.windowId === current.windowId);
  return after?.generation !== generation;
}

function appLaunchRequiresReplacement(
  current: AppLaunchDescriptor,
  next: AppLaunchDescriptor,
): boolean {
  return (
    next.appId !== current.appId ||
    next.surfaceId !== current.surfaceId ||
    next.releaseId !== current.releaseId ||
    stableLaunchHref(next.href) !== stableLaunchHref(current.href)
  );
}

function appLaunchRequiresDirectoryUpdate(
  current: AppLaunchDescriptor,
  next: AppLaunchDescriptor,
): boolean {
  return (
    next.appId !== current.appId ||
    next.surfaceId !== current.surfaceId ||
    stableLaunchHref(next.href, true, next.releaseId !== current.releaseId) !==
      stableLaunchHref(current.href, true, next.releaseId !== current.releaseId)
  );
}

function stableLaunchHref(
  href: string,
  ignoreReleaseId = false,
  ignoreAuthorityVersion = false,
): string {
  const url = new URL(href, "https://tourtois.invalid");
  if (ignoreReleaseId) url.searchParams.delete("releaseId");
  // A promotion changes both selection facts. Leave the admitted mount alone
  // until Reload; other authority/permission changes still reconcile normally.
  if (ignoreAuthorityVersion) url.searchParams.delete("authorityVersion");
  return url.pathname + url.search;
}
