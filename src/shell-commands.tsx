import { CommandDialogs, type ShellCommandState } from "./command-dialogs.js";
import { useLayer } from "@fungi.computer/maosaico";
import type { WhistleCommand, WhistleSnapshot } from "@fungi.computer/whistle";
import { Sigil, isSigilName } from "@fungi.computer/sigils";
import {
  backBinding,
  shellCommands,
  type ShellActions,
} from "@fungi.computer/oyster/shell/commands";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { TourtoisAppSurfaceHost } from "./app-surface.js";
import { AppIcon } from "./app-icon.js";
import { installShellKeys } from "@fungi.computer/oyster/shell/keys";

/** The Back hint for this platform, e.g. "Back (Ctrl K, then [)". */
export function backHint(): string {
  const key = backBinding.slice("<leader> ".length);
  return `Back (${isMac() ? "⌘K" : "Ctrl K"}, then ${key})`;
}

const emptySnapshot: WhistleSnapshot = Object.freeze({
  bindings: Object.freeze([]),
  palette: Object.freeze([]),
  slash: Object.freeze([]),
  help: Object.freeze([]),
  menu: Object.freeze([]),
  agent: Object.freeze([]),
});
const noSubscription = () => () => undefined;
const emptyReader = () => emptySnapshot;

function isMac(): boolean {
  return /Mac|iPhone|iPad/u.test(navigator.userAgent);
}

/**
 * Register the shell's commands, dispatch their direct chords from the host
 * document, and own the which-key and `:` line open state.
 */
export function useShellCommands(
  host: TourtoisAppSurfaceHost | null,
  actions: Omit<ShellActions, "showKeys" | "showCommandLine" | "back"> &
    Readonly<{
      back: () => void;
      showDesktop: () => Promise<void>;
    }>,
): ShellCommandState {
  const [keysOpen, setKeysOpen] = useState(false);
  const [commandLineOpen, setCommandLineOpen] = useState(false);
  const keysOpenRef = useRef(keysOpen);
  keysOpenRef.current = keysOpen;
  const active = useSyncExternalStore(
    host?.subscribe ?? noSubscription,
    host?.active ?? emptyReader,
    host?.active ?? emptyReader,
  );
  // Commands register once per host; each run reads the latest behavior.
  const latest = useRef(actions);
  latest.current = actions;
  const commands = useMemo(
    (): readonly WhistleCommand<never>[] => [
      ...shellCommands({
        openApp: () => {
          setKeysOpen(false);
          setCommandLineOpen(false);
          latest.current.openApp();
        },
        // The leader twice opens the `:` line, like tmux's prefix-prefix.
        showKeys: () => {
          const again = keysOpenRef.current;
          setKeysOpen(!again);
          setCommandLineOpen(again);
        },
        showCommandLine: () => {
          setKeysOpen(false);
          setCommandLineOpen(true);
        },
        focusStep: (step) => {
          latest.current.focusStep(step);
        },
        swapStep: (step) => {
          latest.current.swapStep(step);
        },
        toggleZoom: () => {
          latest.current.toggleZoom();
        },
        back: () => {
          latest.current.back();
        },
      }),
      {
        id: "desktop.show",
        title: "Show desktop",
        category: "Window",
        description:
          "Hide visible Apps, or restore the Apps hidden by Show desktop.",
        projections: {
          bindings: { values: ["<leader> d"], order: 8 },
          palette: { order: 18 },
          help: { order: 8 },
        },
        handler: async () => {
          setKeysOpen(false);
          setCommandLineOpen(false);
          await latest.current.showDesktop();
        },
      },
    ],
    [],
  );
  useEffect(() => host?.registerShellCommands?.(commands), [host, commands]);
  useEffect(
    () => (host ? installShellKeys(document.body, host, isMac()) : undefined),
    [host],
  );
  return { active, keysOpen, setKeysOpen, commandLineOpen, setCommandLineOpen };
}

/** Draw the shared shell dialogs in Tourtois's dialog layer. */
export function ShellCommandDialogs(
  props: Omit<Parameters<typeof CommandDialogs>[0], "container" | "renderIcon">,
): React.JSX.Element {
  const container = useLayer("dialog");
  return (
    <CommandDialogs
      {...props}
      container={container}
      renderIcon={(roles, sigil) =>
        sigil && isSigilName(sigil) ? (
          <Sigil name={sigil} />
        ) : (
          <AppIcon roles={roles} />
        )
      }
    />
  );
}
