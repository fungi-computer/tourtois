import { OverlayRoot } from "@fungi.computer/caps/components/overlay-root";
import { MaosaicoLayers, useLayer } from "@fungi.computer/maosaico";
import { createContext, useContext, useMemo, type ReactNode } from "react";

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

/** Tourtois composes Caps portal destinations with Maosaico's ordered roots. */
export function TourtoisLayers({ children }: { children?: ReactNode }) {
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
  return (
    <MaosaicoLayers onDismiss={dismissal.dismiss}>
      <DismissContext.Provider value={dismissal.dismiss}>
        <OverlayContainers subscribeDismiss={dismissal.subscribe}>
          {children}
        </OverlayContainers>
      </DismissContext.Provider>
    </MaosaicoLayers>
  );
}
