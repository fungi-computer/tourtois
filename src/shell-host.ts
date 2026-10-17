import {
  APP_NAVIGATION_TITLE_MAX,
  parseAppStatusItems,
  APP_NAVIGATION_CRUMBS_MAX,
  APP_NAVIGATION_LABEL_MAX,
  APP_NAVIGATION_MENU_MAX,
  APP_NAVIGATION_PRIMARY_MAX,
  APP_NAVIGATION_SIBLINGS_MAX,
  APP_NAVIGATION_STATUS_MAX,
  type AppHeaderCommand,
  type AppHeaderStatus,
  type AppNavigationState,
} from "@fungi.computer/agar";
import type { AppCommandContribution } from "@fungi.computer/agar/host";
import {
  type TeamWorkbenchChildEvents,
  type TeamWorkbenchHostHandle,
  type WorkbenchChildHandle,
  type WorkbenchChildLaunch,
  type WorkbenchPlatformDestination,
  type WorkbenchGillRequest,
  type WorkbenchGillWatch,
  teamComputerDirectorySchema,
  teamComputerSchema,
} from "@fungi.computer/oyster/shell/workbench";
import { createAppSurfaceCommandHost } from "@fungi.computer/oyster/shell/command-host";
import * as Schema from "effect/Schema";
import { type PlatformControls } from "./platform-controls.js";
import type { GillReply } from "@fungi.computer/gills";
import type { MemberAvatar } from "@fungi.computer/sprite-zdog/avatar";
import { parseMemberAvatar } from "./member-avatar.js";
import * as z from "zod";
import {
  appOpenInputSchema,
  type AppOpenInput,
} from "@fungi.computer/agar/apps";
import type { AppLaunchDescriptor, AppWindowHost } from "./app-windows.js";
import type { TourtoisAppSurfaceHost } from "./app-surface.js";
import {
  workbenchDirectorySchema,
  type WorkbenchDirectory,
} from "@fungi.computer/oyster/shell/workbench-directory";

const teamIdentitySchema = z.strictObject({
  team: z.strictObject({
    teamId: z.string().min(1),
    name: z.string().min(1),
    handle: z.string().min(1),
  }),
});
export type TeamIdentity = z.output<typeof teamIdentitySchema>["team"];
const workbenchComputerDirectorySchema = teamComputerDirectorySchema.extend({
  computers: z.array(
    teamComputerSchema.pick({ computerId: true, name: true }).strip(),
  ),
});
export type TeamComputerPage = z.output<
  typeof workbenchComputerDirectorySchema
>;
const platformDestinationsSchema = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(64),
      label: z.string().min(1).max(80),
    }),
  )
  .max(8);

const relayId = z.string().min(1).max(64);
const relayLabel = z.string().min(1).max(APP_NAVIGATION_LABEL_MAX);
const relayCommands = (maximum: number) =>
  z
    .array(
      z.strictObject({
        id: relayId,
        label: relayLabel,
        variant: z.enum(["primary", "outline", "ghost"]).optional(),
        tone: z.literal("destructive").optional(),
        disabled: z.boolean().optional(),
      }),
    )
    .max(maximum);
const navigationRelaySchema = z
  .strictObject({
    canGoBack: z.boolean(),
    title: z.string().trim().min(1).max(APP_NAVIGATION_TITLE_MAX).optional(),
    crumbs: z
      .array(
        z.strictObject({
          id: relayId,
          label: relayLabel,
          siblings: z
            .array(z.strictObject({ id: relayId, label: relayLabel }))
            .max(APP_NAVIGATION_SIBLINGS_MAX)
            .optional(),
        }),
      )
      .max(APP_NAVIGATION_CRUMBS_MAX)
      .optional(),
    primary: relayCommands(APP_NAVIGATION_PRIMARY_MAX).optional(),
    menu: relayCommands(APP_NAVIGATION_MENU_MAX).optional(),
    status: z
      .array(
        z.strictObject({
          id: relayId,
          label: relayLabel,
          tone: z
            .enum(["neutral", "info", "warning", "success", "error"])
            .optional(),
        }),
      )
      .max(APP_NAVIGATION_STATUS_MAX)
      .optional(),
  })
  .nullable();

/** A child's navigation state as relayed by the host, re-checked here. */
function parseNavigationRelay(value: unknown): AppNavigationState | null {
  const state = navigationRelaySchema.parse(value);
  if (state === null) return null;
  let parsed: AppNavigationState = { canGoBack: state.canGoBack };
  if (state.title !== undefined) parsed = { ...parsed, title: state.title };
  if (state.crumbs !== undefined)
    parsed = {
      ...parsed,
      crumbs: state.crumbs.map((crumb) => {
        const { siblings, ...rest } = crumb;
        return siblings === undefined ? rest : { ...rest, siblings };
      }),
    };
  if (state.primary !== undefined)
    parsed = { ...parsed, primary: state.primary.map(commandOf) };
  if (state.menu !== undefined)
    parsed = { ...parsed, menu: state.menu.map(commandOf) };
  if (state.status !== undefined)
    parsed = { ...parsed, status: state.status.map(statusOf) };
  return parsed;
}

type RelayedCommand = z.output<ReturnType<typeof relayCommands>>[number];
function commandOf(command: RelayedCommand): AppHeaderCommand {
  let copy: AppHeaderCommand = { id: command.id, label: command.label };
  if (command.variant !== undefined)
    copy = { ...copy, variant: command.variant };
  if (command.tone !== undefined) copy = { ...copy, tone: command.tone };
  if (command.disabled !== undefined)
    copy = { ...copy, disabled: command.disabled };
  return copy;
}
function statusOf(item: {
  id: string;
  label: string;
  tone?: AppHeaderStatus["tone"] | undefined;
}): AppHeaderStatus {
  const copy: AppHeaderStatus = { id: item.id, label: item.label };
  return item.tone === undefined ? copy : { ...copy, tone: item.tone };
}

function childLaunch(launch: AppLaunchDescriptor): WorkbenchChildLaunch {
  return {
    windowId: launch.windowId,
    appId: launch.appId,
    releaseId: launch.releaseId,
    surfaceId: launch.surfaceId,
    href: launch.href,
    title: launch.title,
    openRequest: launch.openRequest,
  };
}

/**
 * The trusted shell's view of its host: Team/Computer/App directory reads,
 * child-App mounting and host-offered platform destinations. The host
 * composes Tourtois into its own top-level document, so Tourtois runs with
 * the host's escalated permissions; each child App stays in its own sandboxed
 * frame, mounted inside its window.
 */
export type TourtoisShell = Readonly<{
  team(): Promise<TeamIdentity>;
  computers(input: {
    limit: number;
    offset: number;
  }): Promise<TeamComputerPage>;
  directory(): Promise<WorkbenchDirectory>;
  platformDestinations(): Promise<readonly WorkbenchPlatformDestination[]>;
  settingsSections(): Promise<readonly string[] | null>;
  openPlatformDestination(id: string): Promise<void>;
  takeAppOpenRequest(): Promise<AppOpenInput | null>;
  memberAvatar(): Promise<MemberAvatar | null>;
  /** Team administration the host renders with the owner's own authority. */
  platform: PlatformControls;
  /** Host-admitted Gill requests; the App never receives another App's fetch credentials. */
  requestGill(input: WorkbenchGillRequest): Promise<GillReply>;
  watchGillChanges(
    input: WorkbenchGillRequest,
    onChanged: () => Promise<void>,
  ): Promise<WorkbenchGillWatch>;
  host: TourtoisAppSurfaceHost;
}>;

export function createTourtoisShell(
  workbench: TeamWorkbenchHostHandle,
): TourtoisShell {
  // One Whistle graph for Tourtois's own shell commands and every mounted
  // child's Release-validated commands, so the menu bar and Cmd-K follow focus.
  const commands = createAppSurfaceCommandHost();

  const mount: TourtoisAppSurfaceHost["mount"] = async (
    container,
    launch,
    signal,
    {
      onAgentSessionSelection,
      onComputerChoice,
      onNavigation,
      onAppOpen,
      onAppRole,
      onSelectionChanged,
      onNavigationState,
      onStatusItems,
      onFocus,
    },
  ): Promise<AppWindowHost> => {
    const commandMount = commands.mount(launch.surfaceId, launch.commands);
    let resolveHandle: (handle: WorkbenchChildHandle) => void = () => undefined;
    const handleReady = new Promise<WorkbenchChildHandle>((resolve) => {
      resolveHandle = resolve;
    });
    let contribution: AppCommandContribution | undefined;
    const events: TeamWorkbenchChildEvents = {
      ...(onComputerChoice && { onComputerChoice }),
      onAgentSessionSelection: (selection) =>
        onAgentSessionSelection(selection),
      ...(onNavigation && { onNavigation }),
      ...(onAppOpen && { onAppOpen }),
      ...(onAppRole && { onAppRole }),
      ...(onSelectionChanged && { onSelectionChanged }),
      onCommands: async (presented) => {
        if (presented.length === 0) {
          contribution?.dispose();
          contribution = undefined;
          return;
        }
        if (contribution !== undefined) {
          contribution.update(presented);
          return;
        }
        contribution = await commandMount.handlers.registerCommands({
          commands: presented,
          invoke: async (commandId, invocation) =>
            (await handleReady).invokeCommand(
              commandId,
              invocation.arguments === undefined
                ? { origin: invocation.origin }
                : {
                    arguments: invocation.arguments,
                    origin: invocation.origin,
                  },
            ),
        });
      },
      onReservedChord: (input) =>
        commandMount.handlers.invokeReservedChord(input),
      onFocus: (focused) => {
        if (focused) {
          commands.focus(launch.surfaceId);
          onFocus?.();
        }
        return Promise.resolve();
      },
      ...(onNavigationState && {
        onNavigationState: (state) =>
          // The host parsed this at the App's edge; parse again at ours.
          Promise.resolve(state).then((relayed) => {
            onNavigationState(parseNavigationRelay(relayed));
          }),
      }),
      ...(onStatusItems && {
        onStatusItems: (items) =>
          // The host parsed these at the App's edge; parse again at ours.
          Promise.resolve(items).then((relayed) => {
            onStatusItems(parseAppStatusItems(relayed));
          }),
      }),
    };
    let handle: WorkbenchChildHandle;
    try {
      // The child's frame lives in this window's own slot, so the browser
      // moves, clips and stacks it with the window.
      handle = await workbench.mount(container, childLaunch(launch), events);
    } catch (error) {
      commandMount.dispose();
      throw error;
    }
    resolveHandle(handle);
    if (signal.aborted) {
      commandMount.dispose();
      await handle.dispose();
      throw signal.reason;
    }
    const close = async () => {
      signal.removeEventListener("abort", closeFromParent);
      commandMount.dispose();
      await handle.dispose();
    };
    const closeFromParent = () => {
      void close().catch((cause: unknown) => {
        console.error("Tourtois shell operation failed", cause);
        return undefined;
      });
    };
    signal.addEventListener("abort", closeFromParent, { once: true });
    return {
      setVisibility: (visibility) => handle.setVisibility(visibility),
      reconfigure: (nextLaunch) => handle.reconfigure(childLaunch(nextLaunch)),
      requestClose: () => handle.requestClose(),
      requestBack: () => handle.requestBack(),
      activateNavigation: (activation) => handle.activateNavigation(activation),
      activateStatus: (action) => handle.activateStatus(action),
      dispose: close,
    };
  };

  const host: TourtoisAppSurfaceHost = Object.freeze({
    mount,
    reportAgentSessionSelection: (_teamId, windowId, selection) =>
      workbench.reportAgentSessionSelection(windowId, selection),
    focus: commands.focus,
    registerShellCommands: commands.registerShellCommands,
    registerDirectoryCommands: commands.registerDirectoryCommands,
    menu: commands.menu,
    snapshot: commands.snapshot,
    active: commands.active,
    execute: commands.execute,
    subscribe: commands.subscribe,
  });

  const changeListeners = new Set<() => void>();
  let watching: Promise<void> | undefined;
  const platform: PlatformControls = {
    registerDesktopSettings: (handler) =>
      workbench.registerDesktopSettings(handler),
    openSettings: (location) => {
      // The host renders Settings itself. Restore our own invoker only after
      // that host-owned dialog closes.
      const active = document.activeElement;
      const invoker =
        active instanceof HTMLElement &&
        active.closest('[role="menu"]') === null
          ? active
          : document.querySelector<HTMLButtonElement>(
              ".tourtois-system-menu-trigger",
            );
      void workbench
        .openSettings(location)
        .then(() => {
          if (invoker?.isConnected) invoker.focus();
        })
        .catch((cause: unknown) => {
          console.error("Tourtois shell operation failed", cause);
          return undefined;
        });
    },
    subscribeChanges: (listener) => {
      changeListeners.add(listener);
      watching ??= workbench
        .watchSettingsChanges(() => {
          for (const notify of changeListeners) notify();
          return Promise.resolve();
        })
        .catch((cause: unknown) => {
          console.error("Tourtois shell operation failed", cause);
          return undefined;
        });
      return () => {
        changeListeners.delete(listener);
      };
    },
  };

  return {
    team: async () => teamIdentitySchema.parse(await workbench.team()).team,
    computers: async (input) =>
      workbenchComputerDirectorySchema.parse(await workbench.computers(input)),
    directory: async () =>
      workbenchDirectorySchema.parse(await workbench.directory()),
    platformDestinations: async () =>
      platformDestinationsSchema.parse(await workbench.platformDestinations()),
    settingsSections: async () =>
      z
        .array(z.string())
        .nullable()
        .parse(await workbench.settingsSections()),
    openPlatformDestination: (id) => workbench.openPlatformDestination(id),
    takeAppOpenRequest: async () => {
      const request = await workbench.takeAppOpenRequest();
      return request === null
        ? null
        : Schema.decodeUnknownSync(appOpenInputSchema)(request);
    },
    memberAvatar: async () => parseMemberAvatar(await workbench.memberAvatar()),
    platform,
    requestGill: (input) => workbench.requestGill(input),
    watchGillChanges: (input, onChanged) =>
      workbench.watchGillChanges(input, onChanged),
    host,
  };
}
