// Tourtois's Settings on a standalone Oyster, which has no Settings of its
// own: Apps, Connectors and Keys over the Oyster owner routes. The Oyster page
// mounts this from the picked shell Release's module; a host with its own
// Settings (the Hub) never calls it.
import "@fungi.computer/parakeet/styles.css";
import "./shell.css";
import { AppError } from "@fungi.computer/agar";
import { createQueryClient } from "@fungi.computer/agar/query";
import type { MountPlatformControls } from "@fungi.computer/oyster/shell/shell-module";
import { workbenchDirectorySchema } from "@fungi.computer/oyster/shell/workbench-directory";
import { QueryClientProvider } from "@tanstack/react-query";
import * as S from "effect/Schema";
import { createRoot } from "react-dom/client";
import {
  agentMcpServersViewSchema,
  createPlatformControls,
  keyIssueResultSchema,
  keyRecordSchema,
  keysViewSchema,
  PlatformControlsView,
  type AgentMcpServersPort,
  type KeysPort,
} from "./platform-controls.js";
import { settingsLocationSchema } from "./settings-routes.js";

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
const keys: KeysPort = {
  list: async () => keysViewSchema.parse(await json("/api/keys")),
  issue: async (draft) => {
    const response = await ownerRequest(
      "/api/keys",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
      "The key request was refused",
    );
    return keyIssueResultSchema.parse(await response.json());
  },
  revoke: async (keyId, requestId) => {
    const response = await ownerRequest(
      "/api/keys/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId, requestId }),
      },
      "The key request was refused",
    );
    return keyRecordSchema.parse(await response.json());
  },
};

const directory = async () =>
  workbenchDirectorySchema.parse(await json("/api/workbench/directory"));

export const mountPlatformControls: MountPlatformControls = (root, input) => {
  const controls = createPlatformControls({
    sections: ["home", "apps", "connectors", "keys"],
  });
  const client = createQueryClient();
  const settings = createRoot(root);
  settings.render(
    <QueryClientProvider client={client}>
      <PlatformControlsView
        teamId={input.teamId}
        controls={controls}
        data={{ directory, agentMcpServers, keys }}
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
