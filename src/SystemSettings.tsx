import { AppCallPermissions } from "./AppCallPermissions.js";
import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import {
  AppDesktopSettings,
  type AppDesktopSettingsApp,
} from "./AppDesktopSettings.js";
import {
  addressKey,
  type AppDirectoryEntry,
} from "@fungi.computer/nacre/app-directory";
import type { WorkbenchDesktopSettings } from "@fungi.computer/nacre/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentMcpServers } from "./AgentMcpServers.js";
import { Keys, type KeyAppOption } from "./Keys.js";
import { AppIcon } from "./app-icon.js";
import { AvatarSettings } from "./member-avatar.js";
import { SettingsNavigation } from "./SettingsNavigation.js";
import { SettingsHome } from "./SettingsHome.js";
import {
  offeredSettings,
  type SettingsSectionPorts,
} from "./settings-sections.js";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import {
  SettingsLeaveContext,
  type SettingsLeaveGuard,
} from "./settings-leave-guard.js";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
import {
  WindowFrame,
  WindowHeader,
  WindowActions,
  type WindowHeaderProps,
} from "@fungi.computer/caps/components/window";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@fungi.computer/caps/components/dialog";

import type { SettingsLocation } from "./settings-routes.js";

/** One system-settings surface. The menu only requests opening it. */
export function SystemSettings({
  location: requestedLocation,
  sections: ceiling,
  onNavigate,
  apps,
  appCount,
  onAccepted,
  desktopSettings,
  desktopConsentReadyAt,
  onClosed,
  restoreFocus,
  ports,
}: {
  location: SettingsLocation | null;
  /** The host's navigation ceiling; a section also needs its port. */
  sections?: readonly SettingsLocation["category"][] | undefined;
  onNavigate: (location: SettingsLocation | null) => void;
  apps: readonly (AppDesktopSettingsApp &
    Pick<
      AppDirectoryEntry,
      "address" | "installationId" | "appId" | "displayName" | "icon" | "calls"
    > &
    Readonly<{ roles: readonly string[] }>)[];
  /** The directory's App count once read; null is not zero. */
  appCount: number | null;
  onAccepted: () => Promise<void>;
  desktopSettings: WorkbenchDesktopSettings;
  desktopConsentReadyAt: number;
  onClosed: () => void;
  restoreFocus: boolean;
  /** The sections this host implements. */
  ports: SettingsSectionPorts;
}) {
  const sections = useMemo(
    () => offeredSettings(ceiling, ports),
    [ceiling, ports],
  );
  const location =
    requestedLocation !== null && sections.includes(requestedLocation.category)
      ? requestedLocation
      : null;
  const {
    agentMcpServers,
    keys,
    appPermissions: AppPermissions,
    appAdvanced: AppAdvanced,
  } = ports;
  const avatar = location?.category === "avatar";
  const connectors = location?.category === "connectors";
  const computersSection = location?.category === "computers";
  const keysSection = location?.category === "keys";
  const keyableApps: readonly KeyAppOption[] = useMemo(
    () =>
      apps.flatMap((app) =>
        app.installationId === null
          ? []
          : [
              {
                installationId: app.installationId,
                displayName: app.displayName ?? app.appId,
              },
            ],
      ),
    [apps],
  );
  const defaults = location?.category === "defaults";
  const home = location?.category === "home";
  const appSection = location?.category === "apps";
  // Load App editors only after an App is chosen, then retain their drafts
  // while moving between categories in this dialog.
  const [appsLoaded, setAppsLoaded] = useState(false);
  if (appSection && location.appKey !== null && !appsLoaded)
    setAppsLoaded(true);
  const appLocation = location?.category === "apps" ? location : null;
  const appKey = appLocation?.appKey ?? null;
  // A host without a Permissions or Advanced port never renders that tab.
  // Route requests for those sections (the window chrome's shield and gear)
  // land here too, so fold them into Desktop instead of a blank content area.
  const desktopOnly = AppPermissions === undefined;
  const advanced =
    AppAdvanced !== undefined && appLocation?.section === "advanced";
  const desktop =
    appLocation !== null &&
    !advanced &&
    (desktopOnly || appLocation.section !== "permissions");
  const selected = apps.find((app) => addressKey(app.address) === appKey);
  const guards = useRef(new Set<SettingsLeaveGuard>());
  const register = useCallback((guard: SettingsLeaveGuard) => {
    guards.current.add(guard);
    return () => {
      guards.current.delete(guard);
    };
  }, []);
  const [discard, setDiscard] = useState(false);
  const discardDestination = useRef<SettingsLocation | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const canClose = () => {
    const states = [...guards.current].map((read) => read());
    if (states.includes("pending") || states.includes("uncertain")) {
      setLeaveError(
        states.includes("pending")
          ? "Wait for the current request to finish before closing."
          : "Retry the uncertain request before closing so its request identity is preserved.",
      );
      return false;
    }
    setLeaveError(null);
    return true;
  };
  useEffect(() => {
    if (!location) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...guards.current].some((read) => read() !== "clean"))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [location]);
  const requestNavigation = (next: SettingsLocation | null) => {
    if (!canClose()) return;
    if ([...guards.current].some((read) => read() === "dirty")) {
      discardDestination.current = next;
      setDiscard(true);
      return;
    }
    onNavigate(next);
  };
  const close = () => {
    requestNavigation(null);
  };
  const headerProps: WindowHeaderProps = {
    title: "System Settings",
    actions: <WindowActions title="System Settings" onClose={close} />,
  };
  if (location?.category === "selling" && location.appId !== null)
    headerProps.back = {
      label: "Back to Selling",
      onBack: () => {
        requestNavigation({ category: "selling", appId: null });
      },
    };
  return (
    <Dialog
      open={location !== null}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setAppsLoaded(false);
          onClosed();
        }
      }}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        finalFocus={restoreFocus}
        render={<WindowFrame floating />}
        keepMounted={false}
        className="tourtois-system-settings"
      >
        <DialogTitle className="sr-only">System Settings</DialogTitle>
        <DialogDescription className="sr-only">
          {desktopOnly
            ? "Your desktop and App settings."
            : "Your avatar, Channels, Connectors, App access and App settings."}
        </DialogDescription>
        <WindowHeader {...headerProps} />
        <SettingsLeaveContext.Provider value={register}>
          <div className="tourtois-settings-layout">
            <SettingsNavigation
              sections={sections}
              desktopOnly={desktopOnly}
              location={location}
              apps={apps}
              onNavigate={(next) => {
                if (location?.category === "selling" && location.appId !== null)
                  requestNavigation(next);
                else onNavigate(next);
              }}
            />
            {home ? (
              <SettingsHome
                sections={sections}
                desktopOnly={desktopOnly}
                team={ports.team}
                summary={{
                  appCount,
                  defaultAppCount: ports.summary?.defaultAppCount ?? null,
                  computerCount: ports.summary?.computerCount ?? null,
                }}
                onNavigate={onNavigate}
              />
            ) : null}
            {avatar && ports.avatar !== undefined ? (
              <div className="tourtois-settings-content">
                <AvatarSettings save={ports.avatar.save} />
              </div>
            ) : null}
            {connectors && agentMcpServers !== undefined ? (
              <AgentMcpServers port={agentMcpServers} />
            ) : null}
            {connectors &&
            agentMcpServers === undefined &&
            ports.connectors !== undefined ? (
              <ports.connectors
                target={location.target}
                onNavigate={onNavigate}
              />
            ) : null}
            {location?.category === "selling" && ports.selling !== undefined ? (
              <ports.selling appId={location.appId} onNavigate={onNavigate} />
            ) : null}
            {computersSection && ports.computers !== undefined ? (
              <div className="tourtois-settings-content">
                <ports.computers />
              </div>
            ) : null}
            {keysSection && keys !== undefined ? (
              <Keys port={keys} apps={keyableApps} />
            ) : null}
            {location?.category === "channels" &&
            ports.channels !== undefined ? (
              <ports.channels />
            ) : null}
            {defaults && ports.defaults !== undefined ? (
              <div className="tourtois-settings-content">
                <ports.defaults onAccepted={onAccepted} />
              </div>
            ) : null}
            {appSection && appKey === null ? (
              <section
                className="tourtois-settings-content"
                aria-label="Choose an App"
              >
                <SectionHeading className="tourtois-settings-app-heading">
                  {desktopOnly ? "App desktop" : "App permissions"}
                </SectionHeading>
                <DataList density="compact" aria-label="Apps to review">
                  {apps.map((app) => (
                    <DataRow key={addressKey(app.address)} className="p-0">
                      <ActionRow
                        label={app.displayName ?? app.appId}
                        icon={<AppIcon roles={app.roles} icon={app.icon} />}
                        onClick={() => {
                          onNavigate({
                            category: "apps",
                            appKey: addressKey(app.address),
                            section: desktopOnly ? "desktop" : "permissions",
                          });
                        }}
                      />
                    </DataRow>
                  ))}
                </DataList>
                {appCount === 0 ? (
                  <p>
                    {desktopOnly
                      ? "No Apps installed yet."
                      : "No Apps in this Team yet."}
                  </p>
                ) : null}
              </section>
            ) : null}
            {appsLoaded ? (
              <section
                className="tourtois-settings-content"
                aria-label="App settings"
                hidden={!appSection || appKey === null}
              >
                <Tabs
                  className="flex min-h-0 flex-1 flex-col"
                  value={
                    advanced ? "advanced" : desktop ? "desktop" : "permissions"
                  }
                  onValueChange={(section) => {
                    if (
                      section === "permissions" ||
                      section === "desktop" ||
                      section === "advanced"
                    )
                      onNavigate({ category: "apps", appKey, section });
                  }}
                >
                  <div className="tourtois-settings-app-header">
                    <SectionHeading className="tourtois-settings-app-heading">
                      {selected ? (
                        <AppIcon roles={selected.roles} icon={selected.icon} />
                      ) : null}
                      {selected
                        ? (selected.displayName ?? selected.appId)
                        : "Apps"}
                    </SectionHeading>
                    <TabsList
                      variant="segmented"
                      className="ml-auto w-auto"
                      hidden={
                        !selected || (desktopOnly && AppAdvanced === undefined)
                      }
                      aria-label="App settings sections"
                    >
                      {!desktopOnly ? (
                        <TabsTrigger value="permissions">
                          Permissions
                        </TabsTrigger>
                      ) : null}
                      <TabsTrigger value="desktop">Desktop</TabsTrigger>
                      {AppAdvanced !== undefined ? (
                        <TabsTrigger value="advanced">Advanced</TabsTrigger>
                      ) : null}
                    </TabsList>
                  </div>
                  <div className="tourtois-settings-app-content">
                    {!selected ? (
                      <p>
                        Choose an app to manage its permissions and advanced
                        settings.
                      </p>
                    ) : null}
                    {/* Host editors retain their drafts across tab changes. */}
                    {AppPermissions !== undefined ? (
                      <TabsContent
                        value="permissions"
                        forceMount
                        className="mt-0 flex min-h-0 flex-1 flex-col"
                      >
                        <div
                          className="tourtois-settings-permissions"
                          hidden={!selected}
                        >
                          <AppPermissions
                            selectedKey={appKey}
                            onAccepted={onAccepted}
                          />
                        </div>
                      </TabsContent>
                    ) : null}
                    <TabsContent
                      value="desktop"
                      forceMount
                      className="mt-0 flex min-h-0 flex-1 flex-col"
                    >
                      {selected && desktop && desktopOnly ? (
                        <AppCallPermissions
                          calls={selected.calls}
                          apps={apps}
                        />
                      ) : null}
                      {selected && desktop ? (
                        <AppDesktopSettings
                          key={selected.surfaceId}
                          app={selected}
                          desktop={desktopSettings}
                          consentReadyAt={desktopConsentReadyAt}
                        />
                      ) : null}
                    </TabsContent>
                    {AppAdvanced !== undefined ? (
                      <TabsContent
                        value="advanced"
                        forceMount
                        className="mt-0 flex min-h-0 flex-1 flex-col"
                      >
                        <AppAdvanced
                          selectedKey={appKey}
                          visible={advanced}
                          onNavigate={onNavigate}
                          onAccepted={onAccepted}
                        />
                      </TabsContent>
                    ) : null}
                  </div>
                </Tabs>
              </section>
            ) : null}
          </div>
        </SettingsLeaveContext.Provider>
        {leaveError ? (
          <div className="tourtois-settings-discard" role="alert">
            {leaveError}
          </div>
        ) : null}
        {discard ? (
          <div className="tourtois-settings-discard" role="alert">
            <p>Discard unsaved changes?</p>
            <div className="tourtois-settings-actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDiscard(false);
                }}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!canClose()) return;
                  setDiscard(false);
                  onNavigate(discardDestination.current);
                }}
              >
                Discard changes
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
