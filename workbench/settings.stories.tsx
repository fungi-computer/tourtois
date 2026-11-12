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
import type { SettingsSectionPorts } from "../src/settings-sections.js";
import {
  DiscordChannels,
  type DiscordBinding,
  type DiscordChannelsPort,
} from "../src/DiscordChannels.js";
import {
  WebsiteChannels,
  type WebsiteChannelsPort,
  type WebsiteSite,
} from "../src/WebsiteChannels.js";
import type { KeysPort } from "../src/Keys.js";
import type { ConnectionsPort, ConnectionsView } from "../src/Connections.js";
import type { KeySummary } from "@fungi.computer/ear-tag/keys";
import { createDesktopFixture } from "./fixtures.js";
import { settingsApps, settingsIconApps } from "./settings-fixtures.js";
import "./workbench.css";

export default { title: "Desktop / System Settings" } satisfies StoryDefault;

function settings(
  initial: SettingsLocation,
  state: "full" | "icons" | "calls" = "full",
  ports: SettingsSectionPorts = workbenchPorts,
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
          ports={ports}
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

// Channels are a host port: the story supplies in-memory Website and Discord ones.
const channelsFixtureSite: WebsiteSite = {
  bindingId: "chb_site",
  agentId: "agent_fern",
  selector: {
    provider: "web",
    siteKey: "site_pk_story",
    origins: ["https://shop.example"],
  },
  lifecycle: "active",
  authorityVersion: 1,
  persona: "",
};
const channelsFixtureDiscord: DiscordBinding = {
  bindingId: "chb_discord",
  agentId: "agent_fern",
  selector: {
    provider: "discord",
    applicationId: "1234567890123456789",
    publicKey: "ab".repeat(32),
    guildIds: ["2345678901234567890"],
    channelIds: [],
  },
  lifecycle: "active",
  authorityVersion: 1,
  persona: "",
};
const channelsFixtureAgents = [{ agentId: "agent_fern", name: "Fern" }];
const channelsWebsitePort: WebsiteChannelsPort = {
  scope: "story-channels",
  read: () =>
    Promise.resolve({
      embedOrigin: "https://my-oyster.example",
      agents: channelsFixtureAgents,
      sites: [channelsFixtureSite],
    }),
  create: () => Promise.resolve(channelsFixtureSite),
  update: () => Promise.resolve(channelsFixtureSite),
  conversations: () => Promise.resolve([]),
  transcript: (_site, sessionId) =>
    Promise.resolve({ sessionId, label: "Visitor", lines: [] }),
};
const channelsDiscordPort: DiscordChannelsPort = {
  scope: "story-channels",
  read: () =>
    Promise.resolve({
      interactionsOrigin: "https://my-oyster.example",
      agents: channelsFixtureAgents,
      bindings: [channelsFixtureDiscord],
    }),
  create: () => Promise.resolve(channelsFixtureDiscord),
  update: () => Promise.resolve(channelsFixtureDiscord),
  registerCommands: () =>
    Promise.resolve({ registered: ["2345678901234567890"], failed: [] }),
  conversations: () =>
    Promise.resolve([
      {
        sessionId: "session_discord_a",
        label: "Ava",
        lastEventAt: Date.UTC(2026, 10, 12, 18, 30),
      },
      {
        sessionId: "session_discord_b",
        label: "@bram",
        lastEventAt: Date.UTC(2026, 10, 11, 9, 5),
      },
    ]),
  undelivered: () =>
    Promise.resolve([
      {
        interactionId: "1234567890123456789",
        label: "Bram",
        state: "failed" as const,
        closedAt: Date.UTC(2026, 10, 12, 19, 5),
      },
      {
        interactionId: "1234567890123456780",
        label: "Discord member",
        state: "expired" as const,
        closedAt: Date.UTC(2026, 10, 11, 8, 40),
      },
    ]),
  transcript: (_binding, sessionId) =>
    Promise.resolve({
      sessionId,
      label: "Ava",
      lines: [
        { role: "visitor", text: "Which fern likes shade?" },
        { role: "agent", text: "A holly fern does well in deep shade." },
        { role: "visitor", text: "How often should I water it?" },
        { role: "agent", text: "Weekly, and let the top inch dry out first." },
      ],
    }),
};
const channelsPorts: SettingsSectionPorts = {
  ...workbenchPorts,
  channels: () => (
    <WebsiteChannels
      port={channelsWebsitePort}
      copy={{
        intro: (
          <p className="text-sm">
            Put a chat with one of your Agents on a website you run.
          </p>
        ),
        visitors: (agent) => `A chat with ${agent}.`,
        reach: (agent) => `Visitors talk to ${agent} itself.`,
      }}
    >
      <DiscordChannels port={channelsDiscordPort} />
    </WebsiteChannels>
  ),
};
export const ChannelsOnOyster = settings(
  { category: "channels" },
  "full",
  channelsPorts,
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

function keysFixture(initial: readonly KeySummary<string>[]) {
  let keys: KeySummary<string>[] = initial.map((key) => ({ ...key }));
  const port: KeysPort = {
    scope: "oyster-demo",
    expiry: "optional",
    options: (apps) => {
      const targets = apps.map((app) => ({
        id: app.installationId,
        name: app.displayName,
      }));
      return Promise.resolve([
        {
          capability: "apps.read",
          label: "Read Apps",
          icon: "read",
          hint: "See Apps and their data",
          targets,
        },
        {
          capability: "apps.use",
          label: "Use Apps",
          icon: "allApps",
          hint: "Act through Apps",
          targets,
        },
        {
          capability: "computer.use",
          label: "Use the Computer",
          icon: "computer",
          hint: "Files and commands",
        },
      ] as const);
    },
    list: () => Promise.resolve({ keys: structuredClone(keys) }),
    issue: (draft) => {
      const key: KeySummary<string> = {
        keyId: keysFixtureIds.key.generate(),
        name: draft.name,
        grants: [...draft.grants],
        grantVersion: 1,
        rateLimit: null,
        expiresAt: draft.expiresAt ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastUsedAt: null,
        revokedAt: null,
      };
      keys.push(key);
      return Promise.resolve({ plaintext: `oyk_${key.keyId}_demo`, key });
    },
    revoke: (keyId) => {
      const key = keys.find((candidate) => candidate.keyId === keyId);
      if (!key) throw new Error("Unknown key");
      const revoked = { ...key, revokedAt: Date.now() };
      keys = keys.map((row) => (row.keyId === keyId ? revoked : row));
      return Promise.resolve({
        key: revoked,
        notice: "Key revoked.",
        retry: false,
      });
    },
  };
  return port;
}

const keysSampleRecords: readonly KeySummary<string>[] = [
  {
    keyId: "key_chanterelle",
    name: "chanterelle",
    grants: [
      { capability: "apps.use", targets: { kind: "all" } },
      { capability: "computer.use", targets: { kind: "all" } },
    ],
    grantVersion: 1,
    rateLimit: null,
    updatedAt: Date.now(),
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
        capability: "apps.use",
        targets: {
          kind: "selected",
          ids: ["installation:workflows"],
        },
      },
      {
        capability: "apps.read",
        targets: { kind: "selected", ids: ["installation:bonsai"] },
      },
    ],
    grantVersion: 1,
    rateLimit: null,
    updatedAt: Date.now(),
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
        capability: "apps.use",
        targets: { kind: "selected", ids: ["installation:grove"] },
      },
    ],
    grantVersion: 1,
    rateLimit: null,
    updatedAt: Date.now(),
    expiresAt: null,
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    lastUsedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    revokedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
  },
];

function keysStory(
  state: "full" | "empty" = "full",
  target: "all" | "model" | "media" = "all",
): Story {
  const Story: Story = () => {
    const [client] = useState(
      () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    const [location, setLocation] = useState<SettingsLocation | null>({
      category: "keys",
      target,
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
          ports={{
            keys: port,
            modelKeys: {
              read: () =>
                Promise.resolve({
                  keys: [],
                  agents: [],
                  models: "missing",
                  providers: modelKeyProviderFixture,
                  catalogs: {},
                }),
              addKey: () => Promise.resolve(),
              removeKey: () => Promise.resolve(),
              chooseModel: () => Promise.resolve(),
            },
          }}
        />
      </QueryClientProvider>
    );
  };
  return Story;
}

export const KeysFull = keysStory();
export const KeysEmpty = keysStory("empty");
export const ModelSetup = keysStory("empty", "model");
export const ImageSetup = keysStory("empty", "media");

// The host owns this list; the workbench has no host, so it shows a copy.
const modelKeyProviderFixture = [
  {
    id: "cloudflare-workers-ai",
    label: "Cloudflare Workers AI",
    accountId: true,
  },
  ...Object.entries({
    anthropic: "Anthropic",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    google: "Google Gemini",
    xai: "xAI",
    groq: "Groq",
    mistral: "Mistral",
    deepseek: "DeepSeek",
    cerebras: "Cerebras",
    together: "Together AI",
    moonshotai: "Moonshot AI",
  }).map(([id, label]) => ({ id, label, accountId: false })),
];

// Standalone Connectors: in-memory connections.
function connectorsStory(): Story {
  const Story: Story = () => {
    const [client] = useState(
      () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    const [location, setLocation] = useState<SettingsLocation | null>({
      category: "connectors",
      target: { kind: "list" },
    });
    const [port] = useState((): ConnectionsPort => {
      const view: ConnectionsView = {
        callbackUrl: "https://oyster.example/api/connections/callback",
        agents: [
          { agentId: "gardener", name: "Gardener" },
          { agentId: "librarian", name: "Librarian" },
        ],
        connections: [
          {
            connectionId: "linear",
            name: "linear",
            label: "linear",
            kind: "mcp",
            url: "https://mcp.linear.app/mcp",
            auth: "token",
            state: "connected",
            grants: [{ agentId: "gardener", access: ["list_issues"] }],
          },
        ],
      };
      return {
        list: () => Promise.resolve(structuredClone(view)),
        add: () => Promise.resolve({ authorizeUrl: null }),
        grant: () => Promise.resolve(),
        ungrant: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        tools: () => Promise.resolve(["list_issues", "create_issue"]),
      };
    });
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
          apps={[]}
          appCount={0}
          onAccepted={() => Promise.resolve()}
          onClosed={() => {
            setLocation(null);
          }}
          restoreFocus={false}
          ports={{ connections: port }}
        />
      </QueryClientProvider>
    );
  };
  return Story;
}

export const ConnectorsStandalone = connectorsStory();
