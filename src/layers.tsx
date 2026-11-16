import { OverlayRoot } from "@fungi.computer/caps/components/overlay-root";
import { MaosaicoLayers, useLayer } from "@fungi.computer/maosaico";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

function OverlayContainers({
  children,
  subscribeDismiss,
}: {
  children?: ReactNode;
  subscribeDismiss: (listener: () => void) => () => void;
}) {
  const popover = useLayer("popover");
  const dialog = useLayer("dialog");
  const toast = useLayer("toast");
  const tooltip = useLayer("tooltip");
  const containers = useMemo(
    () => ({ popover, dialog, toast, tooltip }),
    [popover, dialog, toast, tooltip],
  );
  return (
    <OverlayRoot containers={containers} subscribeDismiss={subscribeDismiss}>
      {children}
    </OverlayRoot>
  );
}

const DismissContext = createContext<() => void>(() => undefined);

/**
 * Close every transient popover through the overlay dismiss channel. A window
 * bar calls this as one of its popovers opens, so two never stack.
 */
export function useDismissOverlays(): () => void {
  return useContext(DismissContext);
}

const windows = '[data-maosaico-layer="windows"]';

/**
 * Whether focus landing in an App's frame is the person's doing. A click in a
 * frame is invisible to this document except as the pointer resting on the
 * frame (this document sees it enter the frame element, then nothing) or on
 * a window, and Tab leaves a key press behind. An App that focuses itself while it loads has
 * neither, so it must not close a menu the person just opened. The menu keeps
 * the keyboard too: focus goes back to where it was in this document.
 */
function usePersonDrivenFocus(): () => boolean {
  const overFrame = useRef(false);
  const tabbed = useRef(false);
  const heldFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      overFrame.current =
        event.target instanceof Element &&
        event.target.closest(`iframe, ${windows}`) !== null;
      tabbed.current = false;
    };
    const key = (event: KeyboardEvent) => {
      tabbed.current = event.key === "Tab";
    };
    const focused = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(`iframe, ${windows}`) === null
      )
        heldFocus.current = event.target;
    };
    document.addEventListener("pointerover", pointer, true);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focused, true);
    return () => {
      document.removeEventListener("pointerover", pointer, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focused, true);
    };
  }, []);
  return useCallback(() => {
    const person = overFrame.current || tabbed.current;
    tabbed.current = false;
    if (!person) {
      const held = heldFocus.current;
      const menuOpen =
        document.querySelector(
          '[data-maosaico-layer="popover"] [data-open]',
        ) !== null;
      if (menuOpen && held?.isConnected === true)
        queueMicrotask(() => {
          held.focus({ preventScroll: true });
        });
    }
    return person;
  }, []);
}

/** Tourtois composes Caps portal destinations with Maosaico's ordered roots. */
export function TourtoisLayers({ children }: { children?: ReactNode }) {
  const personDriven = usePersonDrivenFocus();
  const dismissal = useMemo(() => {
    const listeners = new Set<() => void>();
    return {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      dismiss: () => {
        for (const listener of listeners) listener();
      },
    };
  }, []);
  const onDismiss = useCallback(() => {
    if (personDriven()) dismissal.dismiss();
  }, [personDriven, dismissal]);
  return (
    <MaosaicoLayers onDismiss={onDismiss}>
      <DismissContext.Provider value={dismissal.dismiss}>
        <OverlayContainers subscribeDismiss={dismissal.subscribe}>
          {children}
        </OverlayContainers>
      </DismissContext.Provider>
    </MaosaicoLayers>
  );
}
