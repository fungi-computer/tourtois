import type { Story, StoryDefault } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import { createDesktopLayoutClient } from "../src/desktop-client.js";
import {
  createDesktopMethodsFixture,
  desktopCatalogFixture,
} from "./desktop-methods.fixture.js";
import { desktopSettingsHandler } from "../src/desktop/consent.js";
import { SystemSettings } from "../src/SystemSettings.js";
import type { SettingsLocation } from "../src/settings-routes.js";
import { workbenchPorts } from "./host-ports.js";
import type { KeyRecord, KeysPort } from "../src/Keys.js";
import { createDesktopFixture } from "./fixtures.js";
import { settingsApps, settingsIconApps } from "./settings-fixtures.js";
import "./workbench.css";

export default { title: "Desktop / System Settings" } satisfies StoryDefault;

function settings(
  initial: SettingsLocation,
  state: "full" | "icons" | "calls" = "full",
): Story {
  const fixture = createDesktopFixture();
  const Story: Story = () => {
    const [client] = useState(() => {
      fixture.reset();
      return new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });
    const [location, setLocation] = useState<SettingsLocation | null>(initial);
    const [apps] = useState(() => {
      if (state === "calls") {
        const inkcap = settingsApps.find((app) => app.appId === "inkcap");
        if (inkcap === undefined) throw new Error("Inkcap fixture missing");
        const calls = [
          {
            appId: "app_bonsai",
            methods: [
              "files.tree",
              "files.list",
              "files.read",
              "commits.list",
              "rebuildCopies",
              "files.save",
              "files.sync",
              "files.discard",
            ],
          },
        ];
        return [
          ...settingsApps.map((app) =>
            app.appId === "inkcap"
              ? {
                  ...app,
                  declaredCapabilities: [
                    ...app.declaredCapabilities,
                    "apps.call",
                  ],
                  calls,
                }
              : app,
          ),
          {
            ...inkcap,
            address: { kind: "default" as const, appId: "app_bonsai" },
            appId: "app_bonsai",
            displayName: "Bonsai",
            icon: "bonsai",
            roles: [],
          },
        ];
      }
      return state === "icons"
        ? [...settingsApps, ...settingsIconApps]
        : settingsApps;
    });
    const withOwner = async <T,>(
      operation: (
        handler: ReturnType<typeof desktopSettingsHandler>,
      ) => Promise<T>,
    ): Promise<T> => {
      const owner = await createDesktopLayoutClient({
        storage: fixture.storage,
        methods: createDesktopMethodsFixture(fixture.storage, () =>
          desktopCatalogFixture(settingsApps, {
            inbox: { surfaceId: "grove", chosen: true },
          }),
        ),
      });
      try {
        return await operation(desktopSettingsHandler(() => owner));
      } finally {
        owner.close();
      }
    };
    return (
      <QueryClientProvider client={client}>
        <SystemSettings
          location={location}
          onNavigate={setLocation}
          desktopConsentReadyAt={0}
          desktopSettings={{
            readGill: (input) =>
              withOwner((handler) => handler.readGill(input)),
            addGill: (input) => withOwner((handler) => handler.addGill(input)),
            removeGill: (input) =>
              withOwner((handler) => handler.removeGill(input)),
          }}
          apps={apps}
          appCount={apps.length}
          onAccepted={() => Promise.resolve()}
          onClosed={() => {
            setLocation(null);
          }}
          restoreFocus={false}
          ports={workbenchPorts}
        />
      </QueryClientProvider>
    );
  };
  Story.msw = fixture.handlers;
  return Story;
}

export const AppIcons = settings(
  { category: "apps", appKey: null, section: "desktop" },
  "icons",
);
export const Avatar = settings({ category: "avatar" });
export const DesktopGills = settings({
  category: "apps",
  appKey: "default:grove",
  section: "desktop",
});
export const MemberCallsOnOyster = settings(
  { category: "apps", appKey: "default:inkcap", section: "desktop" },
  "calls",
);

// The Keys page is a host port: the story supplies an in-memory one.
const keysFixtureIds = defineIdFamily({
  family: "tourtois-keys-story-fixture",
  version: 1,
  kinds: { key: { prefix: "key" } },
});

// The real standalone App set a key can grant: Bonsai and Workflows run
// alongside the desktop Apps, so the demo must show them too.
const keysDemoApps = (
  [
    { appId: "bonsai", displayName: "Bonsai", icon: "bonsai", roles: [] },
    { appId: "trellis", displayName: "Trellis", icon: "trellis", roles: [] },
    {
      appId: "shed",
      displayName: "Shed",
      icon: "computer",
      roles: ["terminal"],
    },
    {
      appId: "inkcap",
      displayName: "Inkcap",
      icon: "inkcap",
      roles: ["files"],
    },
    {
      appId: "prints",
      displayName: "Prints",
      icon: "prints",
      roles: ["media"],
    },
    {
      appId: "grove",
      displayName: "Grove",
      icon: "chat",
      roles: ["inbox", "sessions"],
    },
  ] as const
).map((entry) => {
  const [template] = settingsApps;
  return {
    ...template,
    address: { kind: "default" as const, appId: entry.appId },
    installationId: `installation:${entry.appId}`,
    appId: entry.appId,
    displayName: entry.displayName,
    icon: entry.icon,
    surfaceId: entry.appId,
    roles: entry.roles,
  };
});

function keysFixture(initial: readonly KeyRecord[]) {
  const keys: KeyRecord[] = initial.map((key) => ({ ...key }));
  const port: KeysPort = {
    list: () => Promise.resolve({ keys: structuredClone(keys) }),
    issue: (draft) => {
      const key: KeyRecord = {
        keyId: keysFixtureIds.key.generate(),
        name: draft.name,
        grants: [...draft.grants],
        computerAccess: draft.computerAccess,
        expiresAt: draft.expiresAt,
        createdAt: Date.now(),
        lastUsedAt: null,
        revokedAt: null,
      };
      keys.push(key);
      return Promise.resolve({ plaintext: `oyk_${key.keyId}_demo`, key });
    },
    revoke: (keyId) => {
      const key = keys.find((candidate) => candidate.keyId === keyId);
      if (!key) throw new Error("Unknown key");
      key.revokedAt = Date.now();
      return Promise.resolve(structuredClone(key));
    },
  };
  return port;
}

const keysSampleRecords: readonly KeyRecord[] = [
  {
    keyId: "key_chanterelle",
    name: "chanterelle",
    grants: [{ level: "write", target: { kind: "all" } }],
    computerAccess: true,
    expiresAt: null,
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    lastUsedAt: Date.now() - 2 * 60 * 60 * 1000,
    revokedAt: null,
  },
  {
    keyId: "key_morel",
    name: "morel",
    grants: [
      {
        level: "write",
        target: {
          kind: "selected",
          installationIds: ["installation:workflows"],
        },
      },
      {
        level: "read",
        target: { kind: "selected", installationIds: ["installation:bonsai"] },
      },
    ],
    computerAccess: false,
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    lastUsedAt: null,
    revokedAt: null,
  },
  {
    keyId: "key_porcini",
    name: "porcini",
    grants: [
      {
        level: "write",
        target: { kind: "selected", installationIds: ["installation:grove"] },
      },
    ],
    computerAccess: false,
    expiresAt: null,
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    lastUsedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    revokedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
  },
];

function keysStory(state: "full" | "empty" = "full"): Story {
  const Story: Story = () => {
    const [client] = useState(
      () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    const [location, setLocation] = useState<SettingsLocation | null>({
      category: "keys",
    });
    const [port] = useState(() =>
      keysFixture(state === "empty" ? [] : keysSampleRecords),
    );
    return (
      <QueryClientProvider client={client}>
        <SystemSettings
          location={location}
          onNavigate={setLocation}
          desktopConsentReadyAt={0}
          desktopSettings={{
            readGill: () => Promise.reject(new Error("not used")),
            addGill: () => Promise.reject(new Error("not used")),
            removeGill: () => Promise.reject(new Error("not used")),
          }}
          apps={keysDemoApps}
          appCount={keysDemoApps.length}
          onAccepted={() => Promise.resolve()}
          onClosed={() => {
            setLocation(null);
          }}
          restoreFocus={false}
          ports={{ keys: port }}
        />
      </QueryClientProvider>
    );
  };
  return Story;
}

export const KeysFull = keysStory();
export const KeysEmpty = keysStory("empty");
