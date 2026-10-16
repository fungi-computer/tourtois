import type { DesktopMethods } from "./desktop-api.js";
import { tourtoisQueryKeys } from "./queries.js";
import { TourtoisLayers } from "./layers.js";
import { useQuery } from "@tanstack/react-query";
import { MaosaicoRoot } from "@fungi.computer/maosaico";
import { useEffect, useRef, useState } from "react";
import type { ComputerOption } from "./app-launch.js";
import { AppWorkbench } from "./AppWorkbench.js";
import type { SettingsLocation } from "./settings-routes.js";
import type { ReactNode } from "react";
import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import type { WorkbenchDirectory } from "@fungi.computer/oyster/shell/workbench-directory";
import type { PlatformControls } from "./platform-controls.js";
import type { AppStorage } from "@fungi.computer/agar/storage";
import type { DesktopGillTransport } from "./desktop/row-gill.js";
import type { AppOpenInput } from "@fungi.computer/agar/apps";

export type TeamTourtoisProps = Readonly<{
  teamId: string;
  /** Local host views share the shell layers without giving the dashboard their authority. */
  children?: ReactNode;
  teamName?: string;
  extraLaunchers?: readonly AppBarItem[];
  settingsLaunchers?: readonly Readonly<{
    id: string;
    label: string;
    icon?: ReactNode;
    location: SettingsLocation;
  }>[];
  systemMenuItems?: ReactNode;
  /** Read the Team's Computers through the host's `computers()` port. */
  computersReader: (signal: AbortSignal) => Promise<readonly ComputerOption[]>;
  /** Read the Team's App directory through the host's `directory()` port. */
  directoryReader: () => Promise<WorkbenchDirectory>;
  /** Take the host address's App-open handoff once, instead of this URL's. */
  takeAppOpenRequest?: () => Promise<AppOpenInput | null>;
  /** Team administration, rendered by the host with the owner's authority. */
  platform: PlatformControls;
  desktopStorage: AppStorage;
  desktopMethods: DesktopMethods;
  gills: DesktopGillTransport;
}>;

function useWorkbenchBounds() {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ height: 0, width: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBounds({
        height: Math.max(0, entry?.contentRect.height ?? 0),
        width: Math.max(0, entry?.contentRect.width ?? 0),
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { bounds, ref };
}

export function TeamTourtois({
  children,
  teamId,
  teamName,
  extraLaunchers,
  settingsLaunchers,
  systemMenuItems,
  computersReader,
  directoryReader,
  takeAppOpenRequest,
  platform,
  desktopStorage,
  desktopMethods,
  gills,
}: TeamTourtoisProps) {
  const { bounds, ref: paneLayerRef } = useWorkbenchBounds();
  const phone = bounds.width <= 540;
  const [tiled, setTiled] = useState(true);
  const { data, isError, isLoading } = useQuery({
    queryKey: tourtoisQueryKeys.workbenchComputers(teamId),
    queryFn: ({ signal }) => computersReader(signal),
  });
  return (
    <main className="tourtois-shell" data-tourtois-shell>
      <TourtoisLayers>
        <div className="tourtois-workbench">
          <MaosaicoRoot
            bounds={bounds}
            containerRef={paneLayerRef}
            tiling={
              tiled || phone
                ? { mainSize: Math.max(0, Math.min(640, bounds.width)), gap: 8 }
                : undefined
            }
          >
            <AppWorkbench
              paneLayerRef={paneLayerRef}
              phone={phone}
              teamId={teamId}
              teamName={teamName ?? teamId}
              initialComputerId={data?.[0]?.computerId ?? null}
              computers={data ?? []}
              computersUnavailable={isLoading || isError}
              onLayoutChange={phone ? undefined : setTiled}
              platform={platform}
              desktopStorage={desktopStorage}
              desktopMethods={desktopMethods}
              gills={gills}
              {...(extraLaunchers ? { extraLaunchers } : {})}
              {...(settingsLaunchers ? { settingsLaunchers } : {})}
              {...(systemMenuItems ? { systemMenuItems } : {})}
              directoryReader={directoryReader}
              {...(takeAppOpenRequest ? { takeAppOpenRequest } : {})}
            />
          </MaosaicoRoot>
        </div>
        {children}
      </TourtoisLayers>
    </main>
  );
}
