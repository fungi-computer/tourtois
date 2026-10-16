import type { WorkbenchDirectory } from "@fungi.computer/oyster/shell/workbench-directory";
import { AppError } from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import { toast } from "@fungi.computer/caps/components/toaster";
import {
  desktopGillAdditionSchema,
  desktopGillSelectionSchema,
  type WorkbenchDesktopSettings,
  type WorkbenchDesktopRegistration,
} from "@fungi.computer/oyster/shell/workbench";
import { addressKey } from "@fungi.computer/oyster/shell/app-directory";
import { tourtoisQueryKeys } from "./queries.js";
import { useQuery } from "@tanstack/react-query";
import type {
  AppPermissionOutcome,
  AppPermissionRequest,
} from "@fungi.computer/agar";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import {
  AppAccessConsent,
  consentableAgentOperations,
  consentableComputerOperations,
  type AppAccessRequest,
} from "./AppAccessConsent.js";
import { RouterProvider, useRouterState } from "@tanstack/react-router";
import {
  createSettingsRouter,
  navigateSettings,
  settingsLocationSchema,
  type SettingsLocation,
} from "./settings-routes.js";
export { parseSettingsLocation } from "./settings-routes.js";
import { MemberAvatarSource } from "./member-avatar.js";
import type { SettingsSectionPorts } from "./settings-sections.js";
export type {
  SettingsSectionPorts,
  TeamAdministrationPort,
} from "./settings-sections.js";
export {
  agentMcpServersViewSchema,
  type AgentMcpServerDraft,
  type AgentMcpServersPort,
  type AgentMcpServersView,
} from "./AgentMcpServers.js";
export {
  keyGrantSchema,
  keyGrantTargetSchema,
  keyIssueResultSchema,
  keyRecordSchema,
  keysViewSchema,
  type KeyAppAccessLevel,
  type KeyAppOption,
  type KeyGrant,
  type KeyGrantTarget,
  type KeyIssueDraft,
  type KeyIssueResult,
  type KeyRecord,
  type KeysPort,
  type KeysView,
} from "./Keys.js";

/**
 * Team administration a dashboard may ask for but never performs itself:
 * System Settings (App permissions, forks, default Apps, Team Git, sprite)
 * and one-click App access consent. The host renders them with the Team
 * owner's own authority; the dashboard only opens them and hears that the
 * Team's Apps changed.
 */
export type PlatformControls = Readonly<{
  openSettings: (location: SettingsLocation) => void;
  registerDesktopSettings: (
    handler: WorkbenchDesktopSettings,
  ) => Promise<WorkbenchDesktopRegistration>;
  /** Observe Team App changes these controls made, to refresh a directory. */
  subscribeChanges: (listener: () => void) => () => void;
}>;

/** The mounted App asking for access, identified by its directory surface. */
export type AppAccessTarget = Readonly<{ surfaceId: string; title: string }>;

/** The host side: the controls plus the consent entry for child Apps. */
export type PlatformControlsHost = PlatformControls &
  Readonly<{
    openSettings: (
      location: SettingsLocation,
      options?: Readonly<{ restoreFocus: boolean; appInitiated?: boolean }>,
    ) => void;
    restoreSettingsFocus: () => boolean;
    desktopConsentReadyAt: () => number;
    /** A child App can suggest Settings; only the member's Review opens them. */
    suggestDesktopSettings: (target: AppAccessTarget) => void;
    requestAppAccess: (
      target: AppAccessTarget,
      input: AppPermissionRequest,
    ) => Promise<AppPermissionOutcome>;
    /** View wiring: current location, navigation and the consent handler. */
    /** Settings the embedding host backs with real data and actions. */
    sections?: readonly SettingsLocation["category"][] | undefined;
    router: ReturnType<typeof createSettingsRouter>;
    navigate: (location: SettingsLocation | null) => void;
    /** The native dialog has finished closing, including its focus trap. */
    settingsClosed: () => void;
    subscribeSettingsClosed: (listener: () => void) => () => void;
    attach: (handler: PlatformControlsHost["requestAppAccess"]) => () => void;
    changed: () => void;
    attachDesktopSettings: (handler: WorkbenchDesktopSettings) => () => void;
    desktopSettings: WorkbenchDesktopSettings;
  }>;

/** One host's platform controls; render them with `PlatformControlsView`. */
export function createPlatformControls(
  options?: Readonly<{
    sections: readonly SettingsLocation["category"][];
  }>,
): PlatformControlsHost {
  const sections = options?.sections.slice();
  const requireOffered = (location: SettingsLocation | null) => {
    if (
      location !== null &&
      sections !== undefined &&
      !sections.includes(location.category)
    )
      throw new AppError("This host does not offer those Settings", {
        code: "CAPABILITY_DENIED",
        retryable: false,
      });
  };
  const router = createSettingsRouter();
  let restoreSettingsFocus = true;
  let settingsOpen = false;
  let appInitiated = false;
  let appReopenAllowedAt = 0;
  let consentReadyAt = 0;
  let handler: PlatformControlsHost["requestAppAccess"] | undefined;
  let desktopHandler: WorkbenchDesktopSettings | undefined;
  const attachDesktopSettings = (handler: WorkbenchDesktopSettings) => {
    desktopHandler = handler;
    return () => {
      if (desktopHandler === handler) desktopHandler = undefined;
    };
  };
  const changeListeners = new Set<() => void>();
  const settingsCloseListeners = new Set<() => void>();
  const navigate = (next: SettingsLocation | null) => {
    requireOffered(next);
    void navigateSettings(router, next).catch((cause: unknown) => {
      console.error("Settings navigation failed", cause);
    });
  };
  const dismissedSuggestions = new Set<string>();
  let retireSuggestion: (() => void) | undefined;
  const controls: PlatformControlsHost = Object.freeze({
    sections,
    attachDesktopSettings,
    registerDesktopSettings: (handler) => {
      const detach = attachDesktopSettings(handler);
      return Promise.resolve({
        close: () => {
          detach();
          return Promise.resolve();
        },
      });
    },
    desktopSettings: {
      readGill: async (input) => {
        const request = desktopGillSelectionSchema.parse(input);
        if (!desktopHandler)
          throw new AppError(
            "The desktop is unavailable. Reopen it and try again.",
            { code: "HOST_FAILURE", retryable: true },
          );
        return desktopHandler.readGill(request);
      },
      addGill: async (input) => {
        const request = desktopGillAdditionSchema.parse(input);
        if (!desktopHandler)
          throw new AppError(
            "The desktop is unavailable. Reopen it and try again.",
            { code: "HOST_FAILURE", retryable: true },
          );
        await desktopHandler.addGill(request);
      },
      removeGill: async (input) => {
        const request = desktopGillSelectionSchema.parse(input);
        if (!desktopHandler)
          throw new AppError(
            "The desktop is unavailable. Reopen it and try again.",
            { code: "HOST_FAILURE", retryable: true },
          );
        await desktopHandler.removeGill(request);
      },
    },
    openSettings: (
      next: SettingsLocation,
      options?: Parameters<PlatformControlsHost["openSettings"]>[1],
    ) => {
      requireOffered(next);
      if (
        options?.appInitiated &&
        (settingsOpen || Date.now() < appReopenAllowedAt)
      )
        throw new AppError(
          "Close Settings and wait before requesting desktop settings again.",
          { code: "CAPABILITY_DENIED", retryable: false },
        );
      if (!settingsOpen) {
        appInitiated = options?.appInitiated ?? false;
        consentReadyAt = appInitiated ? Date.now() + 500 : 0;
      }
      settingsOpen = true;
      // Navigation within the same dialog preserves its return-focus owner.
      restoreSettingsFocus =
        options?.restoreFocus ??
        (router.history.location.pathname === "/closed"
          ? true
          : restoreSettingsFocus);
      navigate(next);
    },
    restoreSettingsFocus: () => restoreSettingsFocus,
    desktopConsentReadyAt: () => consentReadyAt,
    suggestDesktopSettings: (target: AppAccessTarget) => {
      if (dismissedSuggestions.has(target.surfaceId)) return;
      if (settingsOpen || Date.now() < appReopenAllowedAt)
        throw new AppError(
          "Close Settings and wait before suggesting desktop widgets again.",
          {
            code: "CAPABILITY_DENIED",
            retryable: false,
          },
        );
      retireSuggestion?.();
      let retired = false;
      const id = toast(`${target.title} suggests desktop widgets`, {
        toasterId: "app-connections",
        position: "bottom-right",
        duration: 10_000,
        closeButton: true,
        onDismiss: () => {
          if (!retired) dismissedSuggestions.add(target.surfaceId);
        },
        action: (
          <Button
            variant="secondary"
            size="xs"
            aria-label="Review desktop widgets"
            onClick={() => {
              // A delayed Review must not replace another dialog or bypass its cooldown.
              if (!settingsOpen && Date.now() >= appReopenAllowedAt)
                controls.openSettings(
                  {
                    category: "apps",
                    appKey: target.surfaceId,
                    section: "desktop",
                  },
                  { restoreFocus: false, appInitiated: true },
                );
              retire();
            }}
          >
            Review
          </Button>
        ),
      });
      const retire = () => {
        // Sonner calls onDismiss for programmatic retirement too.
        retired = true;
        toast.dismiss(id);
      };
      retireSuggestion = retire;
    },
    subscribeChanges: (listener: () => void) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    requestAppAccess: (target, input) =>
      handler === undefined
        ? Promise.resolve<AppPermissionOutcome>("declined")
        : handler(target, input),
    router,
    navigate,
    settingsClosed: () => {
      settingsOpen = false;
      if (appInitiated) appReopenAllowedAt = Date.now() + 10_000;
      appInitiated = false;
      consentReadyAt = 0;
      for (const listener of settingsCloseListeners) listener();
    },
    subscribeSettingsClosed: (listener: () => void) => {
      settingsCloseListeners.add(listener);
      return () => {
        settingsCloseListeners.delete(listener);
      };
    },
    attach: (next) => {
      handler = next;
      return () => {
        if (handler === next) handler = undefined;
      };
    },
    changed: () => {
      for (const listener of changeListeners) listener();
    },
  });
  return controls;
}

// Settings carry TanStack Form and the permission editors; load them on first
// open so the Team route does not ship them.
const SystemSettings = lazy(async () => {
  const module = await import("./SystemSettings.js");
  return { default: module.SystemSettings };
});

/** Loads settings on first open, then stays mounted so closing runs normally. */
function DeferredSystemSettings(props: ComponentProps<typeof SystemSettings>) {
  const [loaded, setLoaded] = useState(false);
  if (props.location !== null && !loaded) setLoaded(true);
  return loaded ? (
    <Suspense fallback={null}>
      <SystemSettings {...props} />
    </Suspense>
  ) : null;
}

/** The consent dialog a host's own access policy may ask through. */
export type AppAccessDialog = Readonly<{
  /** Ask the member; resolves with their answer once the dialog settles. */
  ask: (
    request: Omit<AppAccessRequest, "settle">,
  ) => Promise<AppPermissionOutcome>;
  /** Open an App's Settings instead, as the member's "customize" answer. */
  customize: (location: SettingsLocation) => "customize";
}>;

/**
 * Data and implemented actions supplied by the embedding host. Every request
 * runs with the signed-in member's own authority on the host's side; a
 * dashboard App never receives their credentials, forms or results.
 */
export type PlatformControlsData = SettingsSectionPorts &
  Readonly<{
    directory(): Promise<WorkbenchDirectory>;
    /**
     * Override the owner consent flow below. Omit it to use the built-in
     * one-click dialog, bounded by the target App's own declared
     * capabilities; the owner's click in this trusted shell is the only grant
     * a host without a separate per-App ceiling needs.
     */
    requestAppAccess?(
      target: AppAccessTarget,
      input: AppPermissionRequest,
      dialog: AppAccessDialog,
    ): Promise<AppPermissionOutcome>;
  }>;

/** Tourtois owns the same Settings renderer on every embedding host. */
export function PlatformControlsView({
  teamId,
  controls,
  data,
}: {
  teamId: string;
  controls: PlatformControlsHost;
  data: PlatformControlsData;
}) {
  const location = useRouterState({
    router: controls.router,
    select: (state) =>
      settingsLocationSchema
        .nullable()
        .parse(state.matches.at(-1)?.loaderData ?? null),
  });
  const restoreFocus = useSyncExternalStore(
    (changed) => controls.router.subscribe("onResolved", changed),
    controls.restoreSettingsFocus,
    () => true,
  );
  const directory = useQuery({
    queryKey: tourtoisQueryKeys.hostSettings(teamId),
    queryFn: () => data.directory(),
    enabled: location !== null,
  });
  const [consent, setConsent] = useState<AppAccessRequest | null>(null);
  useEffect(() => {
    const dialog: AppAccessDialog = {
      ask: (request) =>
        new Promise<AppPermissionOutcome>((resolve) => {
          setConsent({
            ...request,
            settle: (settled) => {
              setConsent(null);
              resolve(settled);
            },
          });
        }),
      customize: (location) => {
        controls.openSettings(location);
        return "customize";
      },
    };
    const requestAppAccess = data.requestAppAccess;
    return controls.attach(
      requestAppAccess === undefined
        ? async (target, input) => {
            const current = await data.directory();
            const app = current.apps.find(
              (candidate) => candidate.surfaceId === target.surfaceId,
            );
            const openSettings = () =>
              dialog.customize({
                category: "apps",
                appKey: app ? addressKey(app.address) : null,
                section: "desktop",
              });
            if (app === undefined) return openSettings();
            const agents = consentableAgentOperations(
              input.agents ?? [],
              app.declaredCapabilities,
            );
            const computers = consentableComputerOperations(
              input.computers ?? [],
              app.declaredCapabilities,
            );
            if (agents.length === 0 && computers.length === 0)
              return openSettings();
            const outcome = await dialog.ask({
              appName: target.title,
              agents,
              computers,
              // This trusted shell only renders for the signed-in owner;
              // their Allow click here is the whole grant, since this host
              // keeps no further per-App ceiling to persist.
              allow: () => Promise.resolve(true),
            });
            return outcome === "customize" ? openSettings() : outcome;
          }
        : (target, input) => requestAppAccess(target, input, dialog),
    );
  }, [controls, data]);
  const settings = (
    <>
      <RouterProvider router={controls.router} />
      <AppAccessConsent request={consent} />
      <DeferredSystemSettings
        location={location}
        sections={controls.sections}
        onNavigate={(next) => {
          controls.navigate(next);
          // Closing Settings may have changed roles, grants or forks.
          if (next === null) controls.changed();
        }}
        apps={directory.data?.apps ?? []}
        appCount={directory.data?.apps.length ?? null}
        onAccepted={async () => {
          await directory.refetch({ throwOnError: true });
          controls.changed();
        }}
        desktopSettings={controls.desktopSettings}
        desktopConsentReadyAt={controls.desktopConsentReadyAt()}
        onClosed={controls.settingsClosed}
        restoreFocus={restoreFocus}
        ports={data}
      />
    </>
  );
  return data.avatar === undefined ? (
    settings
  ) : (
    <MemberAvatarSource read={data.avatar.read}>{settings}</MemberAvatarSource>
  );
}
