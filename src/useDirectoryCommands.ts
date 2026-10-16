import { useEffect, useMemo, useRef } from "react";
import type { TourtoisAppSurfaceHost } from "./app-surface.js";
import type { AppDirectoryApp } from "./app-launch.js";
import type {
  createAppWindowManager,
  AppLaunchDescriptor,
} from "./app-windows.js";

function waitForPaletteCommand(
  host: TourtoisAppSurfaceHost,
  commandId: string,
): Promise<void> {
  const isReady = () =>
    host.active().palette.some((command) => command.commandId === commandId);
  if (isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("The App did not register its declared command."));
    }, 10_000);
    const finish = () => {
      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    };
    const check = () => {
      if (isReady()) finish();
    };
    const unsubscribe = host.subscribe(check);
    check();
  });
}

/** Keep declared commands addressable before their App has mounted. */
export function useDirectoryCommands({
  host,
  directory,
  manager,
  launchFor,
  onFocus,
  onError,
}: {
  host: TourtoisAppSurfaceHost | null;
  directory: readonly AppDirectoryApp[];
  manager: ReturnType<typeof createAppWindowManager>;
  launchFor: (app: AppDirectoryApp) => AppLaunchDescriptor | null;
  onFocus: (windowId: string) => void;
  onError: (message: string) => void;
}) {
  const advertisedCommands = useMemo(
    () =>
      directory.flatMap((installation) =>
        installation.commands.map((command) => ({
          surfaceId: installation.surfaceId,
          appTitle: installation.displayName ?? "App",
          command,
        })),
      ),
    [directory],
  );
  const directoryCommandContext = useRef({
    manager,
    directory,
    onFocus,
    onError,
    launchFor,
  });
  directoryCommandContext.current = {
    manager,
    directory,
    onFocus,
    onError,
    launchFor,
  };
  useEffect(() => {
    if (!host?.registerDirectoryCommands) return;
    return host.registerDirectoryCommands(
      advertisedCommands,
      async (surfaceId, commandId) => {
        const context = directoryCommandContext.current;
        const installation = context.directory.find(
          (app) => app.surfaceId === surfaceId,
        );
        if (!installation) throw new Error("This App is no longer available.");
        const launch = context.launchFor(installation);
        if (!launch) throw new Error("This App is no longer available.");
        try {
          await context.manager.open(launch);
          context.onFocus(launch.windowId);
          const runtimeCommandId = `${encodeURIComponent(surfaceId)}:${commandId}`;
          await waitForPaletteCommand(host, runtimeCommandId);
          const outcome = await host.execute(runtimeCommandId, {
            origin: "palette",
          });
          if (outcome.status === "handled") return;
          if (outcome.status === "failed")
            throw new Error(outcome.error.message);
          if (outcome.status === "unavailable") throw new Error(outcome.reason);
          throw new Error("The App command is no longer available.");
        } catch (error) {
          context.onError(
            error instanceof Error
              ? error.message
              : `${installation.displayName ?? "App"} could not run this command.`,
          );
          throw error;
        }
      },
    );
  }, [host, advertisedCommands]);
}
