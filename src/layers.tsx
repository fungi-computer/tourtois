import { OverlayRoot } from "@fungi.computer/caps/components/overlay-root";
import { MaosaicoLayers, useLayer } from "@fungi.computer/maosaico";
import { useMemo, type ReactNode } from "react";

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
      <OverlayContainers subscribeDismiss={dismissal.subscribe}>
        {children}
      </OverlayContainers>
    </MaosaicoLayers>
  );
}
