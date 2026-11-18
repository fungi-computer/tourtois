// Standalone Oyster Settings chrome, loaded from the chosen shell Release.
// App Permissions frame Oyster's own grants page, never its implementation.
// Connections, Keys and Computers retain their existing host-backed ports.
// A host with its own Settings (the Hub) never calls this entrypoint.
import "@fungi.computer/parakeet/styles.css";
import "./shell.css";
import { AppError } from "@fungi.computer/agar";
import { createQueryClient } from "@fungi.computer/agar/query";
import type { KeyWire } from "@fungi.computer/ear-tag/keys";
import type { MountPlatformControls } from "@fungi.computer/nacre/shell-module";
import {
  workbenchComputerDirectorySchema,
  workbenchDirectorySchema,
} from "@fungi.computer/nacre/workbench-directory";
import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { Prose } from "@fungi.computer/caps/components/prose";
import { toast } from "@fungi.computer/caps/components/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import * as S from "effect/Schema";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  connectionAddedSchema,
  connectionsViewSchema,
  connectionToolsSchema,
  createPlatformControls,
  PlatformControlsView,
  type ConnectionsPort,
  type KeyTargetOption,
  type KeysPort,
} from "./platform-controls.js";
import { createOysterSetupPort, oysterSetupSchema } from "./oyster-setup.js";
import {
  agentModelsViewSchema,
  vaultViewSchema,
  VaultRefusal,
  type VaultPort,
  type VaultUse,
} from "./Vault.js";
import { WORKBENCH_NOTICES } from "./app-toast.js";
import { settingsLocationSchema } from "./settings-routes.js";
import type { PlatformControlsData } from "./platform-controls.js";
import {
  OysterComputers,
  createOysterComputersPort,
} from "./OysterComputers.js";
import {
  DiscordChannels,
  createOysterDiscordChannelsPort,
} from "./DiscordChannels.js";
import {
  WebsiteChannels,
  createOysterWebsiteChannelsPort,
  type WebsiteChannelsCopy,
} from "./WebsiteChannels.js";
import {
  useSettingsLeaveGuard,
  type SettingsLeaveState,
} from "./settings-leave-guard.js";
import type { Accepted } from "./settings-sections.js";

async function json(path: string) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new AppError("Oyster data is unavailable", {
      code:
        response.status === 401 || response.status === 403
          ? "CAPABILITY_DENIED"
          : "HOST_FAILURE",
      retryable: response.status >= 500,
    });
  return S.decodeUnknownSync(S.Json)(await response.json());
}

/** One owner-direct request; a refusal carries the host's own message. */
async function ownerRequest(path: string, init: RequestInit, refused: string) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (response.ok) return response;
  const refusal = S.decodeUnknownOption(
    S.fromJsonString(S.Struct({ error: S.String })),
  )(await response.text());
  throw new AppError(refusal._tag === "Some" ? refusal.value.error : refused, {
    code:
      response.status === 401 || response.status === 403
        ? "CAPABILITY_DENIED"
        : "HOST_FAILURE",
    retryable: response.status >= 500,
  });
}

/** Owner-direct connections; the host never returns a token. */
const connections: ConnectionsPort = {
  list: async () => connectionsViewSchema.parse(await json("/api/connections")),
  add: async (draft) =>
    connectionAddedSchema.parse(
      await (
        await ownerRequest(
          "/api/connections",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          },
          "The connection change was refused",
        )
      ).json(),
    ),
  grant: async ({ connectionId, agentId, access }) => {
    await ownerRequest(
      `/api/connections/${encodeURIComponent(connectionId)}/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access }),
      },
      "The connection change was refused",
    );
  },
  ungrant: async (connectionId, agentId) => {
    await ownerRequest(
      `/api/connections/${encodeURIComponent(connectionId)}/agents/${encodeURIComponent(agentId)}`,
      { method: "DELETE" },
      "The connection change was refused",
    );
  },
  remove: async (connectionId) => {
    await ownerRequest(
      `/api/connections/${encodeURIComponent(connectionId)}`,
      { method: "DELETE" },
      "The connection change was refused",
    );
  },
  tools: async (connectionId) =>
    connectionToolsSchema.parse(
      await json(`/api/connections/${encodeURIComponent(connectionId)}/tools`),
    ).tools,
};

const modelKeyMessages = {
  key_rejected: "The provider rejected this key",
  provider_unavailable: "The provider could not be reached. Try again",
  custody_unavailable:
    "This instance has no credential key. Set OYSTER_CREDENTIAL_KEY and redeploy",
  limit: "Remove a model key before adding another",
  invalid_key: "Choose a provider, name the key and paste it",
  key_removed: "That key was removed",
  key_source_mismatch: "That model does not belong to the key's provider",
  model_unavailable: "That provider has no such model",
  invalid_model_choice: "That model choice is not valid",
} as const;
const vaultMessages = {
  not_found: "That credential was removed. Reload the Vault",
  conflict: "That credential changed since you opened it. Reload the Vault",
  denied: "You can't change this credential",
  invalid_input: "Check the name, sites and value, then try again",
  duplicate_name: "A secret with that reference already exists",
  limit: "Revoke a secret before adding another",
  invalid_endpoint:
    "Bind it to public https hosts only: exact names, no addresses or wildcards",
  unsupported_subject: "That can't be given a secret",
} as const;

/** A request whose host refusal code reads as a sentence. */
async function sentenceRequest(
  path: string,
  init: RequestInit,
  refused: string,
  messages: Readonly<Record<string, string>>,
) {
  try {
    return await ownerRequest(path, init, refused);
  } catch (cause) {
    const sentence =
      cause instanceof AppError
        ? new Map(Object.entries(messages)).get(cause.message)
        : undefined;
    if (sentence !== undefined) throw new VaultRefusal(sentence, { cause });
    throw cause;
  }
}
const modelKeyRequest = (path: string, init: RequestInit, refused: string) =>
  sentenceRequest(path, init, refused, modelKeyMessages);
const vaultRequest = (path: string, init: RequestInit, refused: string) =>
  sentenceRequest(path, init, refused, vaultMessages);

const jsonInit = (method: string, body: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body,
});

/** The instance Vault as `/api/vault` lists it: no value, ever. */
const oysterVaultWire = z.object({
  modelKeys: z.array(
    z.object({
      keyId: z.string(),
      provider: z.string(),
      label: z.string(),
      createdAt: z.number(),
    }),
  ),
  credentials: z.array(z.unknown()),
  coverage: z.unknown(),
});
const agentModelsWire = z.object({
  agents: z.unknown(),
  catalogs: z.unknown(),
  models: z.unknown(),
  providers: z.array(
    z.object({ id: z.string(), label: z.string(), accountId: z.boolean() }),
  ),
});
const subjectWire = z.object({
  kind: z.enum(["agent", "computer", "app", "team-key"]),
  id: z.string().min(1),
});
const credentialUsageWire = z.object({
  usage: z.array(
    z.object({
      subject: subjectWire,
      host: z.string().nullable(),
      method: z.string(),
      outcome: z.enum([
        "placed",
        "refused_destination",
        "refused_grant",
        "upstream_status",
      ]),
      status: z.number().nullable(),
      lastAt: z.number(),
      count: z.number().int().positive(),
    }),
  ),
});
const modelKeyUsageWire = z.object({
  usage: z.array(
    z.object({
      subject: subjectWire.nullable(),
      outcome: z.enum(["upstream_status", "failed"]),
      status: z.number().nullable(),
      lastAt: z.number(),
      count: z.number().int().positive(),
    }),
  ),
});
const credentialPath = (connectionId: string, suffix = "") =>
  `/api/vault/credentials/${encodeURIComponent(connectionId)}${suffix}`;
const subjectPath = (
  connectionId: string,
  subject: Readonly<{ kind: string; id: string }>,
) =>
  credentialPath(
    connectionId,
    `/subjects/${encodeURIComponent(subject.kind)}/${encodeURIComponent(subject.id)}`,
  );

/**
 * Owner-direct Vault: one page over the instance's model keys and Connection
 * credentials. A value goes in once and never comes back. The owner is the
 * only actor on an Oyster, so everything here is theirs to manage.
 */
const vault: VaultPort = {
  read: async () => {
    const [stored, agents, computers] = await Promise.all([
      json("/api/vault"),
      json("/api/agent-models"),
      oysterComputerTargets(),
    ]);
    const held = oysterVaultWire.parse(stored);
    const models = agentModelsWire.parse(agents);
    return vaultViewSchema.parse({
      role: { manageTeam: true, managePersonal: true },
      coverage: held.coverage,
      providers: models.providers.map((provider) => ({
        ...provider,
        baseUrl: false,
      })),
      scopes: ["team"],
      modelKeys: held.modelKeys.map((key) => ({
        keyId: key.keyId,
        provider: key.provider,
        label: key.label,
        scope: "team",
        createdAt: key.createdAt,
        baseUrl: null,
      })),
      credentials: held.credentials,
      subjects: {
        agents: agentModelsViewSchema.shape.agents
          .parse(models.agents)
          .map((agent) => ({ id: agent.agentId, name: agent.name })),
        computers: computers.map((computer) => ({
          id: computer.id,
          name: computer.name,
        })),
      },
    });
  },
  addSecret: async (draft) => {
    await vaultRequest(
      "/api/vault/secrets",
      jsonInit("POST", JSON.stringify(draft)),
      "The secret was refused",
    );
  },
  updateCredential: async (connectionId, change) => {
    await vaultRequest(
      credentialPath(connectionId),
      jsonInit("PUT", JSON.stringify(change)),
      "The change was refused",
    );
  },
  revokeCredential: async (connectionId, expectedVersion) => {
    await vaultRequest(
      credentialPath(connectionId),
      jsonInit("DELETE", JSON.stringify({ expectedVersion })),
      "The credential could not be revoked",
    );
  },
  grant: async (connectionId, subject) => {
    await vaultRequest(
      subjectPath(connectionId, subject),
      { method: "PUT" },
      "The grant was refused",
    );
  },
  ungrant: async (connectionId, subject) => {
    await vaultRequest(
      subjectPath(connectionId, subject),
      { method: "DELETE" },
      "The grant could not be removed",
    );
  },
  credentialUsage: async (connectionId) =>
    credentialUsageWire
      .parse(await json(credentialPath(connectionId, "/usage")))
      .usage.map((use): VaultUse => ({
        subject: use.subject,
        host: use.host,
        method: use.method,
        outcome: use.outcome,
        status: use.status,
        count: use.count,
        lastAt: use.lastAt,
      })),
  modelKeys: {
    add: async ({ provider, label, apiKey, accountId }) => {
      await modelKeyRequest(
        "/api/model-keys",
        jsonInit(
          "POST",
          JSON.stringify({
            provider,
            label,
            apiKey,
            // JSON drops an absent account ID, as the strict door expects.
            accountId,
          }),
        ),
        "The model key was refused",
      );
    },
    remove: async (keyId) => {
      await modelKeyRequest(
        `/api/model-keys/${encodeURIComponent(keyId)}`,
        { method: "DELETE" },
        "The model key could not be removed",
      );
    },
    usage: async (keyId) =>
      modelKeyUsageWire
        .parse(
          await json(
            `/api/vault/model-keys/${encodeURIComponent(keyId)}/usage`,
          ),
        )
        .usage.map((use): VaultUse => ({
          subject: use.subject,
          host: null,
          method: null,
          outcome: use.outcome,
          status: use.status,
          count: use.count,
          lastAt: use.lastAt,
        })),
  },
  agentModels: {
    read: async () => {
      const models = agentModelsWire.parse(await json("/api/agent-models"));
      return agentModelsViewSchema.parse({
        agents: models.agents,
        catalogs: models.catalogs,
        models: models.models,
      });
    },
    choose: async (agentId, draft) => {
      await modelKeyRequest(
        `/api/agent-models/${encodeURIComponent(agentId)}`,
        jsonInit(
          "PUT",
          JSON.stringify(
            draft.keyId === null
              ? {
                  keySource: "workers-ai",
                  model: {
                    providerId: "cloudflare-workers-ai",
                    modelId: "@cf/moonshotai/kimi-k2.6",
                  },
                }
              : {
                  keySource: "byok",
                  keyId: draft.keyId,
                  model: { providerId: draft.provider, modelId: draft.modelId },
                },
          ),
        ),
        "The model could not be saved",
      );
    },
  },
};

const directory = async () =>
  workbenchDirectorySchema.parse(await json("/api/workbench/directory"));

/**
 * The Computers a key can be limited to: the owner's fleet, page by page, or
 * the one Computer a host without a fleet serves.
 */
async function oysterComputerTargets(): Promise<readonly KeyTargetOption[]> {
  const current = await directory();
  if (current.computerContext !== "owner-fleet")
    return current.computer === undefined
      ? []
      : [{ id: current.computer.computerId, name: current.computer.name }];
  const targets: KeyTargetOption[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = workbenchComputerDirectorySchema.parse(
      await json(
        `/api/workbench/computers?${new URLSearchParams({
          limit: "100",
          offset: String(offset),
        })}`,
      ),
    );
    for (const computer of page.computers)
      targets.push({ id: computer.computerId, name: computer.name });
    offset = page.nextOffset;
  }
  return targets;
}

/** Owner-direct Keys custody; a plaintext secret comes back only once, on issue. */
function createOysterKeysPort(
  oysterKeysWire: Pick<KeyWire<string>, "issue" | "revoke" | "summary">,
): KeysPort {
  const oysterKeysView = z.strictObject({
    keys: z.array(oysterKeysWire.summary),
  });
  const oysterKeyIssue = z.strictObject({
    plaintext: z.string().min(1),
    key: oysterKeysWire.summary,
  });
  const oysterKeyMutation = z.strictObject({ key: oysterKeysWire.summary });
  return {
    scope: "oyster",
    expiry: "optional",
    tracksUse: true,
    options: async (apps) => {
      const targets = apps.map((app) => ({
        id: app.installationId,
        name: app.displayName,
      }));
      return [
        {
          capability: "apps.read",
          label: "Read Apps",
          icon: "read",
          hint: "See Apps and their data",
          targets,
        },
        {
          capability: "apps.use",
          label: "Use Apps and run Workflows",
          icon: "allApps",
          hint: "Act through Apps",
          targets,
        },
        {
          capability: "computer.use",
          label: "Use Computers",
          icon: "computer",
          hint: "Files and commands. Pick Computers to keep the key on them; all follows the Computer you select.",
          targets: await oysterComputerTargets(),
        },
      ];
    },
    list: async () => oysterKeysView.parse(await json("/api/keys")),
    issue: async (draft) => {
      const response = await ownerRequest(
        "/api/keys",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(oysterKeysWire.issue.parse(draft)),
        },
        "The key request was refused",
      );
      return oysterKeyIssue.parse(await response.json());
    },
    revoke: async (keyId, requestId) => {
      const response = await ownerRequest(
        "/api/keys/revoke",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            oysterKeysWire.revoke.parse({ keyId, requestId }),
          ),
        },
        "The key request was refused",
      );
      const result = oysterKeyMutation.parse(await response.json());
      return { key: result.key, notice: "Key revoked.", retry: false };
    },
  };
}

const permissionFrameMessage = z.strictObject({
  type: z.literal("oyster.permissions"),
  event: z.enum(["accepted", "state"]),
  state: z.enum(["clean", "dirty", "pending", "uncertain"]),
});

function OysterPermissionsFrame({
  installationId,
  onAccepted,
}: {
  installationId: string;
  onAccepted: Accepted;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sizeObserver = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(0);
  const leave = useRef<SettingsLeaveState>("clean");
  useSettingsLeaveGuard(() => leave.current);
  useEffect(
    () => () => {
      sizeObserver.current?.disconnect();
    },
    [],
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const source = frame.current?.contentWindow;
      if (
        !source ||
        event.source !== source ||
        event.origin !== window.location.origin
      )
        return;
      const parsed = permissionFrameMessage.safeParse(event.data);
      if (!parsed.success) return;
      leave.current = parsed.data.state;
      if (parsed.data.event === "accepted") {
        void onAccepted().catch((cause: unknown) => {
          console.error("App permissions Settings refresh failed", cause);
          toast.error(
            "Settings could not be refreshed. Reopen Settings to try again.",
            {
              toasterId: WORKBENCH_NOTICES,
            },
          );
        });
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
    };
  }, [onAccepted]);
  return (
    <>
      <iframe
        ref={frame}
        title="App permissions"
        src={`/api/installations/${encodeURIComponent(installationId)}/grants`}
        className="w-full shrink-0 border-0"
        style={{ height }}
        onLoad={() => {
          sizeObserver.current?.disconnect();
          const body = frame.current?.contentDocument?.body;
          if (!body) return;
          // The same-origin host page owns its markup. Observe its body rather
          // than its editor internals; Settings remains the only scroll owner.
          const resize = () => {
            setHeight(Math.ceil(body.getBoundingClientRect().height));
          };
          sizeObserver.current = new ResizeObserver(resize);
          sizeObserver.current.observe(body);
          resize();
        }}
      />
    </>
  );
}

function OysterAppPermissions({
  selectedKey,
  onAccepted,
}: {
  selectedKey: string | null;
  onAccepted: Accepted;
}) {
  if (!selectedKey?.startsWith("installation:")) return null;
  return (
    <OysterPermissionsFrame
      key={selectedKey}
      installationId={selectedKey.slice("installation:".length)}
      onAccepted={onAccepted}
    />
  );
}

/** What a visitor can and cannot reach on a self-hosted Oyster. */
const oysterWebsiteCopy: WebsiteChannelsCopy = {
  intro: (
    <p className="text-sm">
      Put a chat with one of your Agents on a website you run. Visitors open it
      from a button in the corner of the page; only you sign in to this Oyster.
    </p>
  ),
  visitors: (agentName) =>
    `A chat with ${agentName}. Visitors don’t sign in, and they see its replies. Message limits apply to each visitor.`,
  reach: (agentName) =>
    `Visitors talk to ${agentName} itself, with ${agentName}’s own tools and permissions. They cannot sign in to this Oyster or reach your account. The address list limits where the chat appears, not who can call it directly.`,
};

/** Image generation on this Oyster: Cloudflare Workers AI, set up once. */
export function OysterImageModels() {
  return (
    <section className="tourtois-settings-stack" aria-label="Image models">
      <SectionHeading>Image models</SectionHeading>
      <p className="tourtois-settings-lede">
        Flux images use Cloudflare Workers AI.
      </p>
      <Prose>
        <p>Local trials can upload images. To generate:</p>
        <ol>
          <li>Enable Workers AI in your Cloudflare account.</li>
          <li>Deploy this Oyster using the setup guide.</li>
          <li>Open Prints at the deployed Oyster address.</li>
        </ol>
      </Prose>
      <FormFooter divider={false}>
        <Button asChild>
          <a
            href="https://docs.fungi.computer/guides/run-your-own-oyster/#image-models"
            target="_blank"
            rel="noreferrer"
          >
            Set up Cloudflare Workers AI
          </a>
        </Button>
      </FormFooter>
    </section>
  );
}

export const mountPlatformControls: MountPlatformControls = (root, input) => {
  const keys = createOysterKeysPort(input.keysWire);
  const requestAppAccess: NonNullable<
    PlatformControlsData["requestAppAccess"]
  > = (target, request, dialog) =>
    input.requestAppAccess(target, request, {
      ask: dialog.ask,
      customize: (installationId) =>
        dialog.customize({
          category: "apps",
          appKey:
            installationId === null ? null : `installation:${installationId}`,
          section: "permissions",
        }),
    });
  const controls = createPlatformControls({
    sections: [
      "home",
      "apps",
      "connectors",
      "computers",
      "vault",
      "keys",
      "channels",
    ],
  });
  const computersPort = createOysterComputersPort(
    new URL(window.location.origin),
  );
  const computers = () => (
    <OysterComputers
      teamId={input.teamId}
      port={computersPort}
      onChanged={controls.changed}
    />
  );
  const websitesPort = createOysterWebsiteChannelsPort(
    new URL(window.location.origin),
  );
  const discordPort = createOysterDiscordChannelsPort(
    new URL(window.location.origin),
  );
  const channels = () => (
    <WebsiteChannels port={websitesPort} copy={oysterWebsiteCopy}>
      <DiscordChannels port={discordPort} />
    </WebsiteChannels>
  );
  const setup = createOysterSetupPort({
    readFacts: async () => oysterSetupSchema.parse(await json("/api/setup")),
    openSettings: (location) => {
      controls.openSettings(location, { restoreFocus: false });
    },
    subscribeSettingsClosed: controls.subscribeSettingsClosed,
  });
  // A key added or removed changes what is ready before Settings closes.
  const trackedVault: VaultPort = {
    ...vault,
    modelKeys: {
      ...vault.modelKeys,
      add: async (draft) => {
        await vault.modelKeys.add(draft);
        setup.changed();
      },
      remove: async (keyId) => {
        await vault.modelKeys.remove(keyId);
        setup.changed();
      },
    },
  };
  const client = createQueryClient();
  const settings = createRoot(root);
  settings.render(
    <QueryClientProvider client={client}>
      <PlatformControlsView
        teamId={input.teamId}
        controls={controls}
        data={{
          directory,
          connections,
          computers,
          channels,
          keys,
          imageModels: OysterImageModels,
          vault: trackedVault,
          requestAppAccess,
          appPermissions: OysterAppPermissions,
        }}
      />
    </QueryClientProvider>,
  );
  return Promise.resolve({
    controls: {
      sections: controls.sections,
      subscribeSettingsClosed: controls.subscribeSettingsClosed,
      subscribeChanges: controls.subscribeChanges,
      attachDesktopSettings: controls.attachDesktopSettings,
      requestAppAccess: controls.requestAppAccess,
      // The notification trigger stays private; Apps receive the live subscription.
      setup: { read: setup.read, subscribe: setup.subscribe, open: setup.open },
      parseSettings: (value) =>
        S.decodeUnknownSync(S.Json)(settingsLocationSchema.parse(value)),
      retryInstall: async (installationId: string) => {
        const response = await fetch(
          `/api/trial/starters/${encodeURIComponent(installationId)}/retry`,
          { method: "POST", credentials: "same-origin" },
        );
        if (!response.ok)
          throw new AppError("The retry was not accepted", {
            code: "HOST_FAILURE",
            retryable: true,
          });
      },
      openSettings: (value, options) => {
        controls.openSettings(settingsLocationSchema.parse(value), options);
      },
    },
    suggestDesktopSettings: (surfaceId) => {
      controls.suggestDesktopSettings({ surfaceId, title: surfaceId });
    },
    dispose: () => {
      settings.unmount();
      client.clear();
    },
  });
};
