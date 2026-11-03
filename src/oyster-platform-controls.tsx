// Standalone Oyster Settings chrome, loaded from the chosen shell Release.
// App Permissions frame Oyster's own grants page, never its implementation.
// Connectors, Keys and Computers retain their existing host-backed ports.
// A host with its own Settings (the Hub) never calls this entrypoint.
import "@fungi.computer/parakeet/styles.css";
import "./shell.css";
import { AppError } from "@fungi.computer/agar";
import { createQueryClient } from "@fungi.computer/agar/query";
import type { KeyWire } from "@fungi.computer/ear-tag/keys";
import type { MountPlatformControls } from "@fungi.computer/nacre/shell-module";
import { workbenchDirectorySchema } from "@fungi.computer/nacre/workbench-directory";
import { QueryClientProvider } from "@tanstack/react-query";
import * as S from "effect/Schema";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  agentMcpServersViewSchema,
  createPlatformControls,
  PlatformControlsView,
  type AgentMcpServersPort,
  type KeysPort,
} from "./platform-controls.js";
import { modelKeysViewSchema, type ModelKeysPort } from "./ModelKeys.js";
import { settingsLocationSchema } from "./settings-routes.js";
import type { PlatformControlsData } from "./platform-controls.js";
import {
  OysterComputers,
  createOysterComputersPort,
} from "./OysterComputers.js";
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

/** Owner-direct Agent MCP server custody; the host never returns a token. */
const agentMcpServers: AgentMcpServersPort = {
  list: async () =>
    agentMcpServersViewSchema.parse(await json("/api/agent-mcp-servers")),
  add: async (agentId, draft) => {
    await ownerRequest(
      `/api/agent-mcp-servers/${encodeURIComponent(agentId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
      "The MCP server change was refused",
    );
  },
  remove: async (agentId, serverId) => {
    await ownerRequest(
      `/api/agent-mcp-servers/${encodeURIComponent(agentId)}/${encodeURIComponent(serverId)}`,
      { method: "DELETE" },
      "The MCP server change was refused",
    );
  },
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
const modelKeyMessage = (code: string): string =>
  new Map<string, string>(Object.entries(modelKeyMessages)).get(code) ?? code;

/** A model-key request whose host refusal code reads as a sentence. */
async function modelKeyRequest(
  path: string,
  init: RequestInit,
  refused: string,
) {
  try {
    return await ownerRequest(path, init, refused);
  } catch (cause) {
    if (cause instanceof AppError)
      throw new Error(modelKeyMessage(cause.message), { cause });
    throw cause;
  }
}

const jsonInit = (method: string, body: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body,
});

/** Owner-direct model-key custody: a key goes in once and never comes back. */
const modelKeys: ModelKeysPort = {
  read: async () => {
    const [keys, agents] = await Promise.all([
      json("/api/model-keys"),
      json("/api/agent-models"),
    ]);
    return modelKeysViewSchema.parse({
      keys: z.object({ keys: z.unknown() }).parse(keys).keys,
      agents: z.object({ agents: z.unknown() }).parse(agents).agents,
    });
  },
  addKey: async (draft) => {
    await modelKeyRequest(
      "/api/model-keys",
      jsonInit("POST", JSON.stringify(draft)),
      "The model key was refused",
    );
  },
  removeKey: async (keyId) => {
    await modelKeyRequest(
      `/api/model-keys/${encodeURIComponent(keyId)}`,
      { method: "DELETE" },
      "The model key could not be removed",
    );
  },
  chooseModel: async (agentId, draft) => {
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
};

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
          label: "Use Apps and run Workflows",
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
      ]);
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

const directory = async () =>
  workbenchDirectorySchema.parse(await json("/api/workbench/directory"));

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
  const [refreshFailed, setRefreshFailed] = useState(false);
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
        setRefreshFailed(false);
        void onAccepted().catch((cause: unknown) => {
          console.error("App permissions Settings refresh failed", cause);
          setRefreshFailed(true);
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
      {refreshFailed ? (
        <p role="alert">
          Permissions saved. Settings could not refresh. Close and reopen
          Settings to retry.
        </p>
      ) : null}
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
    sections: ["home", "apps", "connectors", "computers", "keys"],
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
  const client = createQueryClient();
  const settings = createRoot(root);
  settings.render(
    <QueryClientProvider client={client}>
      <PlatformControlsView
        teamId={input.teamId}
        controls={controls}
        data={{
          directory,
          agentMcpServers,
          computers,
          keys,
          modelKeys,
          requestAppAccess,
          appPermissions: OysterAppPermissions,
        }}
      />
    </QueryClientProvider>,
  );
  return Promise.resolve({
    controls: {
      ...controls,
      parseSettings: (value) =>
        S.decodeUnknownSync(S.Json)(settingsLocationSchema.parse(value)),
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
