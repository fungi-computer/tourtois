// Tourtois's Settings on a standalone Oyster, which has no Settings of its
// own: Apps, Connectors and Keys over the Oyster owner routes. The Oyster page
// mounts this from the picked shell Release's module; a host with its own
// Settings (the Hub) never calls it.
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
import { createRoot } from "react-dom/client";
import {
  agentMcpServersViewSchema,
  createPlatformControls,
  PlatformControlsView,
  type AgentMcpServersPort,
  type KeysPort,
} from "./platform-controls.js";
import { settingsLocationSchema } from "./settings-routes.js";
import type { PlatformControlsData } from "./platform-controls.js";
import {
  OysterComputers,
  createOysterComputersPort,
} from "./OysterComputers.js";

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
        { capability: "apps.read", label: "Read Apps", targets },
        {
          capability: "apps.use",
          label: "Use Apps and run Workflows",
          targets,
        },
        { capability: "computer.use", label: "Use the Computer" },
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
          section: "desktop",
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
        data={{ directory, agentMcpServers, computers, keys, requestAppAccess }}
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
