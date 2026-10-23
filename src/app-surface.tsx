import { createContext, useContext, type ReactNode } from "react";
import type {
  WhistleCommand,
  WhistleExecutionInput,
  WhistleExecutionOutcome,
  WhistleMenuProjection,
  WhistleSnapshot,
} from "@fungi.computer/whistle";
import type {
  AgentSessionSelection,
  AppNavigationState,
  AppStatusItem,
  FileNavigationInput,
} from "@fungi.computer/agar";
import type { AppOpenInput, AppRoleChoice } from "@fungi.computer/agar/apps";
import type { AppDeclaredCommand } from "@fungi.computer/puffball/app";
import type { AppWindowMount } from "./app-windows.js";
import type { WindowEvents } from "@fungi.computer/nacre/window-manager";

/** What one mounted App may raise toward the shell. */
export type TourtoisAppMountEvents = Pick<WindowEvents, "onDeliveryPending"> &
  Readonly<{
    onComputerChoice?: () => Promise<void>;
    onAgentSessionSelection: (
      selection: AgentSessionSelection | null,
    ) => Promise<void>;
    /** A presentation-neutral file handoff to another App. */
    onNavigation?: (input: FileNavigationInput) => Promise<void>;
    onAppOpen?: (input: AppOpenInput) => Promise<void>;
    /** Which App the Team's role routing would open for one role. */
    onAppRole?: (role: string) => Promise<AppRoleChoice>;
    onSelectionChanged?: () => Promise<boolean>;
    /** The App's parsed navigation state for its window chrome. */
    onNavigationState?: (state: AppNavigationState | null) => void;
    /** The App's parsed status readouts for its window's status bar. */
    onStatusItems?: (items: readonly AppStatusItem[]) => void;
    /**
     * The App's own document took focus, as when the person clicks into it.
     * Its sandboxed frame keeps that pointer from this document, so the App's
     * focus report is what raises its window.
     */
    onFocus?: () => void;
  }>;

export type TourtoisAppSurfaceHost = Readonly<{
  /** Mount an App and route its presentation-neutral events here. */
  mount: (
    container: Parameters<AppWindowMount>[0],
    launch: Parameters<AppWindowMount>[1],
    signal: Parameters<AppWindowMount>[2],
    events: TourtoisAppMountEvents,
  ) => ReturnType<AppWindowMount>;
  /** Select the App whose commands are currently addressable by the shell. */
  focus?: (surfaceId: string | null) => void;
  /** Register Tourtois's global shell commands in the shared Whistle graph. */
  registerShellCommands?: (
    commands: readonly WhistleCommand<never>[],
  ) => () => void;
  /** Project Release-advertised rows into Cmd-K before the App is mounted. */
  registerDirectoryCommands?: (
    commands: readonly Readonly<{
      surfaceId: string;
      appTitle: string;
      command: AppDeclaredCommand;
    }>[],
    run: (surfaceId: string, commandId: string) => Promise<void>,
  ) => () => void;
  /** Commands contributed by the currently focused App window. */
  menu: () => readonly WhistleMenuProjection[];
  /** The shell-owned semantic command graph, including every mounted App. */
  snapshot: () => WhistleSnapshot;
  /**
   * Commands active for the current focus: shell rows plus the focused App's
   * rows. Palette, keys and the command line read this, never the whole graph.
   */
  active: () => WhistleSnapshot;
  /** Execute an active command or an exact host-owned programmatic action. */
  execute: (
    commandId: string,
    input: WhistleExecutionInput,
  ) => Promise<WhistleExecutionOutcome>;
  /** Bind one mounted App's explicit Agent Session selection to the shell. */
  reportAgentSessionSelection?: (
    teamId: string,
    mountId: string,
    selection: AgentSessionSelection | null,
  ) => Promise<void> | void;
  /** Observe focused App and command-graph changes. */
  subscribe: (listener: () => void) => () => void;
}>;

const AppSurfaceHostContext = createContext<TourtoisAppSurfaceHost | null>(
  null,
);

export function AppSurfaceHostProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: TourtoisAppSurfaceHost | null;
}) {
  return (
    <AppSurfaceHostContext.Provider value={value}>
      {children}
    </AppSurfaceHostContext.Provider>
  );
}

/** The outer authenticated host supplies the isolated App transport. */
export function useAppSurfaceHost(): TourtoisAppSurfaceHost | null {
  return useContext(AppSurfaceHostContext);
}
