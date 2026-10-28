import { useCallback, useLayoutEffect, useMemo, type ReactNode } from "react";
import { CommandMenu } from "@fungi.computer/caps/blocks/command-menu";
import { Combobox } from "@fungi.computer/caps/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import type {
  WhistleCommandKey,
  WhistleExecutionOutcome,
  WhistlePaletteProjection,
  WhistleSnapshot,
} from "@fungi.computer/whistle";
import type { AppDeclaredCommand } from "@fungi.computer/puffball/app";
import {
  appDirectorySourceId,
  type AppSurfaceCommandHost,
} from "@fungi.computer/nacre/command-host";
import {
  leaderKeyMatches,
  leaderKeys,
  parseChord,
  type LeaderKey,
} from "@fungi.computer/nacre/keys";

function isMac(): boolean {
  return /Mac|iPhone|iPad/u.test(navigator.userAgent);
}

/** Current command view and the host-owned dialog visibility. */
export type ShellCommandState = Readonly<{
  active: WhistleSnapshot;
  keysOpen: boolean;
  /** Open or close the leader-key dialog in the owning shell. */
  setKeysOpen: (open: boolean) => void;
  commandLineOpen: boolean;
  /** Open or close the command palette in the owning shell. */
  setCommandLineOpen: (open: boolean) => void;
}>;

/** One installed App advertised in the shell command palette. */
export type PaletteApp = Readonly<{
  commands: readonly AppDeclaredCommand[];
  name: string;
  icon?: string | null | undefined;
  roles: readonly string[];
  surfaceId: string;
}>;

function chordKey(key: string): string {
  switch (key) {
    case "enter":
      return "Enter";
    case "escape":
      return "Esc";
    case "left":
      return "←";
    case "right":
      return "→";
    case "up":
      return "↑";
    case "down":
      return "↓";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

function commandKeycaps(
  commandId: string,
  active: WhistleSnapshot,
  mac: boolean,
  declared?: AppDeclaredCommand,
): readonly string[] {
  const leader = leaderKeys(active).find((row) => row.commandId === commandId);
  if (leader !== undefined)
    return [mac ? "⌘ K" : "Ctrl K", "then", chordKey(leader.key)];
  const binding = active.bindings.find((row) => row.commandId === commandId);
  const declaredBinding = declared?.projections?.bindings?.values.find(
    (value) => value.startsWith("<leader>"),
  );
  if (declaredBinding !== undefined)
    return [mac ? "⌘ K" : "Ctrl K", "then", chordKey(declaredBinding.slice(8))];
  if (binding === undefined) return [];
  const chord = parseChord(binding.binding, mac);
  if (chord === null) return [];
  return [
    ...(chord.meta ? ["⌘"] : []),
    ...(chord.ctrl ? ["Ctrl"] : []),
    ...(chord.alt ? ["Alt"] : []),
    ...(chord.shift ? ["Shift"] : []),
    chordKey(chord.key),
  ];
}

function outcomeMessage(outcome: WhistleExecutionOutcome): string | null {
  if (outcome.status === "handled") return null;
  if (outcome.status === "failed")
    return "That command couldn’t finish. Please try again.";
  if (outcome.status === "unavailable") return outcome.reason;
  return "That command is no longer available.";
}

/** Which-key list and `:` line for the focused window, drawn from Caps. */
export function CommandDialogs({
  host,
  state,
  focusedWindow,
  directoryApps,
  onStatus,
  finalFocus,
  container: dialog,
  renderIcon,
}: Readonly<{
  host: Pick<AppSurfaceCommandHost, "appCommand" | "execute"> | null;
  state: ShellCommandState;
  focusedWindow:
    | Readonly<{
        launch: Readonly<{
          appId: string;
          icon?: string | null | undefined;
          commands: readonly AppDeclaredCommand[];
          roles: readonly string[];
          surfaceId: string;
          title: string;
        }>;
      }>
    | undefined;
  directoryApps: readonly PaletteApp[];
  onStatus: (message: string) => void;
  finalFocus: () => HTMLElement | null;
  container: HTMLElement | null;
  renderIcon: (roles: readonly string[], sigil?: string) => ReactNode;
}>): React.JSX.Element {
  const { active, keysOpen, setKeysOpen, commandLineOpen, setCommandLineOpen } =
    state;
  const focusedTitle = focusedWindow?.launch.title ?? null;
  const keys = useMemo(() => leaderKeys(active), [active]);
  const groups = useMemo(() => {
    const shell = keys.filter((row) => row.scope === undefined);
    const app = keys.filter((row) => row.scope !== undefined);
    return [
      { label: "Workspace", rows: shell },
      { label: focusedTitle ?? "Focused App", rows: app },
    ].filter((group) => group.rows.length > 0);
  }, [focusedTitle, keys]);
  const palette = useMemo(
    () =>
      active.palette.filter(
        (command) => command.availability.status === "available",
      ),
    [active],
  );
  const focusedApp = focusedWindow
    ? {
        commands: focusedWindow.launch.commands,
        name: focusedWindow.launch.title,
        icon: focusedWindow.launch.icon,
        roles: focusedWindow.launch.roles,
        surfaceId: focusedWindow.launch.surfaceId,
      }
    : undefined;
  // The App a palette row belongs to, and the command its Release declares.
  const paletteEntry = (command: WhistlePaletteProjection) => {
    const target = host?.appCommand(command);
    if (target === undefined) return undefined;
    const app =
      target.surfaceId === focusedApp?.surfaceId
        ? focusedApp
        : command.sourceId === appDirectorySourceId
          ? directoryApps.find((entry) => entry.surfaceId === target.surfaceId)
          : undefined;
    if (app === undefined) return undefined;
    return {
      app,
      declared: app.commands.find((entry) => entry.id === target.commandId),
    };
  };
  const isFocusedCommand = (command: WhistlePaletteProjection) =>
    command.scope === focusedApp?.surfaceId ||
    (focusedApp !== undefined &&
      paletteEntry(command)?.app.surfaceId === focusedApp.surfaceId);
  const orderedPaletteRows = [
    ...palette.filter(isFocusedCommand),
    ...palette.filter(
      (command) =>
        command.sourceId === appDirectorySourceId && !isFocusedCommand(command),
    ),
    ...palette.filter(
      (command) =>
        command.scope === undefined &&
        command.sourceId !== appDirectorySourceId,
    ),
  ];
  const seenPaletteIds = new Set<string>();
  const paletteRows = orderedPaletteRows.filter((command) => {
    if (seenPaletteIds.has(command.commandId)) return false;
    seenPaletteIds.add(command.commandId);
    return true;
  });
  const mac = isMac();
  const run = useCallback(
    (command: WhistleCommandKey, origin: "keyboard" | "palette") => {
      if (!host) return;
      void host.execute(command, { origin }).then((outcome) => {
        const message = outcomeMessage(outcome);
        if (message !== null) onStatus(message);
      });
    },
    [host, onStatus],
  );
  const choose = useCallback(
    (row: LeaderKey) => {
      setKeysOpen(false);
      if (row.availability.status === "unavailable") {
        onStatus(row.availability.reason);
        return;
      }
      run(row.command, "keyboard");
    },
    [onStatus, run, setKeysOpen],
  );
  useLayoutEffect(() => {
    if (!keysOpen) return;
    // The leader sequence belongs to the shell as soon as it opens; Base UI
    // focuses its dialog on the next animation frame, after a fast second key.
    const owner = dialog?.ownerDocument ?? document;
    const onKeyDown = (event: KeyboardEvent) => {
      const row = keys.find((candidate) =>
        leaderKeyMatches(event, candidate.key),
      );
      if (row === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      choose(row);
    };
    owner.addEventListener("keydown", onKeyDown, true);
    return () => {
      owner.removeEventListener("keydown", onKeyDown, true);
    };
  }, [choose, dialog, keys, keysOpen]);
  return (
    <>
      <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
        <DialogContent
          container={dialog}
          className="tourtois-command-palette"
          data-tourtois-which-key=""
          finalFocus={finalFocus}
        >
          <DialogTitle>Keys</DialogTitle>
          <DialogDescription>
            Press a key, or {isMac() ? "⌘K" : "Ctrl+K"} again for the command
            line.
          </DialogDescription>
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <p>{group.label}</p>
              <CommandMenu
                aria-label={`${group.label} keys`}
                items={group.rows.map((row) => ({
                  id: row.commandId,
                  label: row.title,
                  shortcut: row.key,
                  disabled: row.availability.status === "unavailable",
                }))}
                onSelect={(id) => {
                  const row = group.rows.find((item) => item.commandId === id);
                  if (row) choose(row);
                }}
              />
            </section>
          ))}
        </DialogContent>
      </Dialog>
      <Dialog open={commandLineOpen} onOpenChange={setCommandLineOpen}>
        <DialogContent
          container={dialog}
          className="tourtois-command-palette"
          finalFocus={finalFocus}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <div className="tourtois-command-palette-heading">
            {focusedApp
              ? renderIcon(focusedApp.roles, focusedApp.icon ?? undefined)
              : null}
            <span>{focusedTitle ?? "Commands"}</span>
          </div>
          <Combobox<WhistlePaletteProjection>
            activeTone="primary"
            aria-label="Available commands"
            emptyMessage="No matching commands"
            getKey={(command) => command.commandId}
            getLabel={(command) => command.title}
            getSearchText={(command) => {
              const app = paletteEntry(command)?.app;
              return `${command.title} ${command.category} ${command.description ?? ""} ${app?.name ?? ""} ${app ? `opens ${app.name}` : ""}`;
            }}
            groupBy={(command) => {
              if (isFocusedCommand(command)) return "";
              if (command.sourceId === appDirectorySourceId)
                return "Other apps";
              return "Workspace";
            }}
            inputProps={{ "aria-label": "Search commands" }}
            items={paletteRows}
            placeholder=":"
            renderItem={(command) => (
              <div className="tourtois-command-palette-item">
                <span className="tourtois-command-palette-item-icon">
                  {(() => {
                    const entry = paletteEntry(command);
                    if (entry === undefined) return null;
                    return renderIcon(
                      entry.app.roles,
                      entry.declared?.sigil ?? entry.app.icon ?? undefined,
                    );
                  })()}
                </span>
                <span className="tourtois-command-palette-item-title">
                  {command.title}
                </span>
                {command.sourceId === appDirectorySourceId ? (
                  paletteEntry(command)?.app.name !== focusedApp?.name ? (
                    <small>
                      opens {paletteEntry(command)?.app.name ?? "App"}
                    </small>
                  ) : null
                ) : null}
                {(() => {
                  const declared = paletteEntry(command)?.declared;
                  return (
                    <span className="tourtois-command-palette-shortcut">
                      {commandKeycaps(
                        command.commandId,
                        active,
                        mac,
                        declared,
                      ).map((key, index) =>
                        key === "then" ? (
                          <span key={`${key}-${String(index)}`}>then</span>
                        ) : (
                          <kbd
                            className="kbd kbd-sm"
                            key={`${key}-${String(index)}`}
                          >
                            {key}
                          </kbd>
                        ),
                      )}
                    </span>
                  );
                })()}
              </div>
            )}
            value={null}
            onValueChange={(_value, command) => {
              if (!command) return;
              setCommandLineOpen(false);
              run(command.command, "palette");
            }}
          />
          <div className="tourtois-command-palette-footer">
            <span className="tourtois-command-palette-close-hint">
              Esc to close
            </span>
            <span className="tourtois-command-palette-leader-hint">
              <kbd className="kbd kbd-sm">{mac ? "⌘ K" : "Ctrl K"}</kbd>
              <span>then</span>
              <kbd className="kbd kbd-sm">?</kbd>
              <span>for all keys</span>
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
