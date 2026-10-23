import { tourtoisQueryKeys } from "./queries.js";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "@fungi.computer/agar/query";
import type {
  MountShell,
  ShellMountInput,
} from "@fungi.computer/nacre/shell-module";
import { DropdownMenuItem } from "@fungi.computer/caps/components/dropdown-menu";
import { tourtoisLaunchers } from "./desktop/own-launchers.js";
import { Sigil } from "@fungi.computer/sigils";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { TeamTourtois } from "./TeamDesktop.js";
import { AppSurfaceHostProvider } from "./app-surface.js";
import { accountAvatarQuery, MemberAvatarSource } from "./member-avatar.js";
import { createTourtoisShell, readWorkbenchComputers } from "./shell-host.js";

function CanonicalStatus({ message }: { message: string }): React.JSX.Element {
  return (
    <main className="tourtois-shell tourtois-team-desktop" data-tourtois-shell>
      <p className="tourtois-directory-status" role="status">
        {message}
      </p>
    </main>
  );
}

/** Tourtois's own settings page for the Team's role defaults. */
const settingsLaunchers = tourtoisLaunchers.map((launcher) => ({
  ...launcher,
  icon: <Sigil name={launcher.icon} />,
}));

/** Read the host's Team and offered destinations before mounting the desktop. */
function MountedTourtois({
  shell,
}: {
  shell: ShellMountInput;
}): React.JSX.Element {
  const directory = useQuery({
    queryKey: tourtoisQueryKeys.workbench(),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const workbench = createTourtoisShell(shell.workbench);
      const [team, destinations, sections] = await Promise.all([
        workbench.team(),
        workbench.platformDestinations(),
        workbench.settingsSections(),
      ]);
      signal.throwIfAborted();
      return {
        team,
        destinations,
        sections,
        workbench,
      };
    },
  });
  const connection = directory.data;
  const client = useQueryClient();
  const platform = connection?.workbench.platform;
  // Avatar edits happen in host-rendered Settings; re-read the saved avatar.
  useEffect(
    () =>
      platform?.subscribeChanges(() => {
        void client.invalidateQueries({ queryKey: accountAvatarQuery });
      }),
    [client, platform],
  );
  if (directory.isError)
    return <CanonicalStatus message="This Team dashboard is unavailable." />;
  if (!connection) return <CanonicalStatus message="Connecting…" />;
  return (
    <AppSurfaceHostProvider value={connection.workbench.host}>
      <MemberAvatarSource read={() => connection.workbench.memberAvatar()}>
        <TeamTourtois
          key={connection.team.teamId}
          teamId={connection.team.teamId}
          teamName={connection.team.name}
          computersReader={(signal) =>
            readWorkbenchComputers(connection.workbench, signal)
          }
          directoryReader={() => connection.workbench.directory()}
          takeAppOpenRequest={() => connection.workbench.takeAppOpenRequest()}
          platform={connection.workbench.platform}
          desktopStorage={shell.storage}
          desktopMethods={shell.methods}
          gills={connection.workbench}
          settingsLaunchers={settingsLaunchers.filter(
            (launcher) =>
              connection.sections === null ||
              connection.sections.includes(launcher.location.category),
          )}
          systemMenuItems={connection.destinations.map(({ id, label }) => (
            <DropdownMenuItem
              key={id}
              onSelect={() => {
                void connection.workbench
                  .openPlatformDestination(id)
                  .catch((cause: unknown) => {
                    console.error("Tourtois host operation failed", cause);
                    return undefined;
                  });
              }}
            >
              {label}
            </DropdownMenuItem>
          ))}
        />
      </MemberAvatarSource>
    </AppSurfaceHostProvider>
  );
}

/**
 * Tourtois's shell module contract: render Tourtois as the host's trusted
 * shell in this top-level document.
 */
export const mountShell: MountShell = (root, shell) => {
  const queryClient = createQueryClient();
  // The Release bundles its own React runtime. Keep its useId values distinct
  // from the embedding host's labels, controls and portalled overlays.
  const reactRoot = createRoot(root, { identifierPrefix: "tourtois-shell-" });
  reactRoot.render(
    <QueryClientProvider client={queryClient}>
      <MountedTourtois shell={shell} />
    </QueryClientProvider>,
  );
  return Promise.resolve(() => {
    reactRoot.unmount();
    queryClient.clear();
  });
};
