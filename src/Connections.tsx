import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataRow,
  FactRow,
} from "@fungi.computer/caps/components/data-list";
import { FieldSet, FormFooter } from "@fungi.computer/caps/components/field";
import {
  CheckKey,
  CheckKeys,
} from "@fungi.computer/caps/components/icon-checkbox";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { SchemaForm, field, useSchemaForm } from "@fungi.computer/caps/form";
import { Sigil } from "@fungi.computer/sigils";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState, type ComponentType } from "react";
import type { ConnectorsTarget, Navigate } from "./settings-sections.js";
import * as z from "zod";
import { SettingsItem } from "./settings-item.js";

/** What an Agent may do with one connection: everything, only reads, or named tools. */
const connectionAccessSchema = z.union([
  z.literal("all"),
  z.literal("read"),
  z.array(z.string().min(1).max(256)).max(256),
]);
export type ConnectionAccess = z.output<typeof connectionAccessSchema>;

/** The connections an owner holds, with who may use each. No secret ever appears. */
export const connectionsViewSchema = z.strictObject({
  /** The redirect URL to register when bringing your own OAuth app; null when the host has no sign-in. */
  callbackUrl: z.string().min(1).nullable(),
  agents: z.array(
    z.strictObject({ agentId: z.string().min(1), name: z.string() }),
  ),
  connections: z.array(
    z.strictObject({
      connectionId: z.string().min(1),
      name: z.string().min(1),
      label: z.string().min(1),
      kind: z.enum(["mcp", "openapi"]),
      url: z.string().min(1),
      auth: z.enum(["none", "token", "oauth"]),
      state: z.enum(["connected", "pending", "reconnect_required"]),
      grants: z.array(
        z.strictObject({
          agentId: z.string().min(1),
          access: connectionAccessSchema,
        }),
      ),
    }),
  ),
});
export type ConnectionsView = z.output<typeof connectionsViewSchema>;
export type ConnectionRecord = ConnectionsView["connections"][number];

/** What the owner submits to connect one MCP server. */
export type ConnectionDraft = Readonly<{
  name: string;
  url: string;
  bearer: string | null;
  /** Sign in at the server instead of pasting a token; the client is optional. */
  oauth?: Readonly<{
    clientId?: string | undefined;
    clientSecret?: string | undefined;
  }>;
}>;
/** Where to send the owner to finish signing in, when the server asked for it. */
export const connectionAddedSchema = z.object({
  authorizeUrl: z.string().nullable(),
});
export const connectionToolsSchema = z.strictObject({
  tools: z.array(z.string().min(1)).max(1_024),
});

/**
 * The one Settings port for connections, on every host: who holds what, who
 * may use it, and the owner's controls. A host with kinds of its own mounts
 * them beside the shared list through `hostSections`.
 */
export type ConnectionsPort = Readonly<{
  list(): Promise<ConnectionsView>;
  add(draft: ConnectionDraft): Promise<z.output<typeof connectionAddedSchema>>;
  /** Give one Agent access, or change what it has. */
  grant(input: {
    connectionId: string;
    agentId: string;
    access: ConnectionAccess;
  }): Promise<void>;
  ungrant(connectionId: string, agentId: string): Promise<void>;
  remove(connectionId: string): Promise<void>;
  /** The tool names an MCP server offers, for choosing a narrower grant. */
  tools(connectionId: string): Promise<readonly string[]>;
  /** Where the host edits a connection it has its own editor for, or null. */
  editor?(connection: ConnectionRecord): ConnectorsTarget | null;
  /** The host's own connector editors (Apps, Git, importing a spec), shown beside the list. */
  hostSections?: ComponentType<{
    target: ConnectorsTarget;
    onNavigate: Navigate;
  }>;
}>;

const queryKey = ["tourtois", "connections"] as const;

const toolsQuery = (port: ConnectionsPort, connectionId: string) =>
  queryOptions({
    queryKey: [...queryKey, "tools", connectionId],
    queryFn: () => port.tools(connectionId),
  });

const authText = {
  none: "No token",
  token: "Token sealed",
  oauth: "Signed in",
} as const;
const stateText = {
  connected: "",
  pending: " · Waiting for sign-in",
  reconnect_required: " · Sign in again",
} as const;
const accessText = (access: ConnectionAccess) =>
  access === "all"
    ? "All tools"
    : access === "read"
      ? "Read only"
      : `${String(access.length)} selected`;

/**
 * Connections settings: what this instance reaches outside, which Agents may
 * use it, and how much. Secrets stay with the owner, never with an Agent.
 */
export function Connections({
  port,
  target,
  onNavigate,
}: {
  port: ConnectionsPort;
  target: ConnectorsTarget;
  onNavigate: Navigate;
}) {
  const client = useQueryClient();
  const view = useQuery({ queryKey, queryFn: () => port.list() });
  const refresh = () => client.invalidateQueries({ queryKey });
  const remove = useMutation({
    mutationFn: (connectionId: string) => port.remove(connectionId),
    onSuccess: refresh,
  });
  const agents = view.data?.agents ?? [];
  const connections = view.data?.connections ?? [];
  // A fresh form after each connection, so the token field empties.
  const [formKey, setFormKey] = useState(0);
  const HostSections = port.hostSections;
  return (
    <section
      className="tourtois-settings-content tourtois-connectors"
      aria-label="Connections"
    >
      <SectionHeading>Connections</SectionHeading>
      <p className="tourtois-settings-lede">
        Connect a remote MCP server, then choose which Agents may use it. A
        token is sealed by this host, never given to an Agent, and never shown
        again.
      </p>
      {view.data?.callbackUrl ? (
        <DataList density="compact" aria-label="Redirect URL">
          <FactRow icon={<Sigil name="internet" />} label="Redirect URL">
            <code className="text-[length:inherit]">
              {view.data.callbackUrl}
            </code>
          </FactRow>
        </DataList>
      ) : null}
      {view.isPending ? <p>Loading connections…</p> : null}
      {view.isError ? (
        <div role="status" className="tourtois-settings-notice">
          <p>Connections could not be loaded.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void view.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {view.isSuccess ? (
        <>
          {connections.length === 0 ? (
            <p>No connections yet.</p>
          ) : (
            <DataList aria-label="Connections">
              {connections.map((connection) => (
                <DataRow key={connection.connectionId}>
                  <SettingsItem
                    icon={<Sigil name="connected" />}
                    title={connection.label}
                    detail={
                      <>
                        <p>
                          {connection.url} · {authText[connection.auth]}
                          {stateText[connection.state]}
                        </p>
                        <AgentAccess
                          connection={connection}
                          agents={agents}
                          port={port}
                          onChanged={refresh}
                        />
                        <div className="tourtois-settings-item-keys mt-2">
                          {port.editor?.(connection) ? (
                            <KeycapButton
                              density="compact"
                              label="Edit"
                              aria-label={`Edit ${connection.label}`}
                              onClick={() => {
                                const target = port.editor?.(connection);
                                if (target)
                                  onNavigate({
                                    category: "connectors",
                                    target,
                                  });
                              }}
                            />
                          ) : null}
                          <KeycapButton
                            density="compact"
                            tone="destructive"
                            label="Remove"
                            aria-label={`Remove ${connection.label}`}
                            disabled={remove.isPending}
                            onClick={() => {
                              remove.mutate(connection.connectionId);
                            }}
                          />
                        </div>
                      </>
                    }
                  />
                </DataRow>
              ))}
            </DataList>
          )}
          {remove.isError ? (
            <p role="alert">The connection could not be removed.</p>
          ) : null}
          <AddConnection
            key={formKey}
            signIn={view.data.callbackUrl !== null}
            onAdd={async (draft) => {
              const added = await port.add(draft);
              // OAuth servers finish at the authorization server, then return here.
              if (added.authorizeUrl !== null) {
                window.location.assign(added.authorizeUrl);
                return;
              }
              await refresh();
              setFormKey((current) => current + 1);
            }}
          />
        </>
      ) : null}
      {HostSections ? (
        <HostSections target={target} onNavigate={onNavigate} />
      ) : null}
    </section>
  );
}

/** Who may use one connection, and how much; each change takes effect on the Agent's next call. */
function AgentAccess({
  connection,
  agents,
  port,
  onChanged,
}: {
  connection: ConnectionRecord;
  agents: ConnectionsView["agents"];
  port: ConnectionsPort;
  onChanged: () => Promise<void>;
}) {
  const change = useMutation({
    mutationFn: async (next: {
      agentId: string;
      access: ConnectionAccess | null;
    }) => {
      if (next.access === null)
        await port.ungrant(connection.connectionId, next.agentId);
      else
        await port.grant({
          connectionId: connection.connectionId,
          agentId: next.agentId,
          access: next.access,
        });
    },
    onSuccess: onChanged,
  });
  if (agents.length === 0) return <p>Create an Agent to share this.</p>;
  const grantFor = (agentId: string) =>
    connection.grants.find((grant) => grant.agentId === agentId);
  return (
    <FieldSet
      legend={`Agents using ${connection.label}`}
      icon={<Sigil name="agent" />}
      disabled={change.isPending || connection.state !== "connected"}
    >
      <CheckKeys>
        {agents.map((agent) => (
          <CheckKey
            key={agent.agentId}
            name={`${connection.connectionId}:${agent.agentId}`}
            label={agent.name}
            icon={<Sigil name="agent" />}
            hint={
              grantFor(agent.agentId) === undefined
                ? "No access"
                : accessText(grantFor(agent.agentId)?.access ?? "all")
            }
            checked={grantFor(agent.agentId) !== undefined}
            onChange={(event) => {
              change.mutate({
                agentId: agent.agentId,
                access: event.currentTarget.checked ? "all" : null,
              });
            }}
          />
        ))}
      </CheckKeys>
      {agents.flatMap((agent) => {
        const grant = grantFor(agent.agentId);
        return grant === undefined
          ? []
          : [
              <ChooseAccess
                key={agent.agentId}
                connection={connection}
                agentName={agent.name}
                access={grant.access}
                port={port}
                onChoose={(access) => {
                  change.mutate({ agentId: agent.agentId, access });
                }}
              />,
            ];
      })}
      {change.isError ? (
        <p role="alert">The access could not be changed.</p>
      ) : null}
    </FieldSet>
  );
}

/** Narrow one Agent's access: everything, reads only, or the tools you pick. */
function ChooseAccess({
  connection,
  agentName,
  access,
  port,
  onChoose,
}: {
  connection: ConnectionRecord;
  agentName: string;
  access: ConnectionAccess;
  port: ConnectionsPort;
  onChoose: (access: ConnectionAccess) => void;
}) {
  const selecting = Array.isArray(access);
  const tools = useQuery({
    ...toolsQuery(port, connection.connectionId),
    enabled: selecting && connection.kind === "mcp",
  });
  const modes =
    connection.kind === "mcp"
      ? ([
          ["all", "All tools"],
          ["pick", "Selected tools"],
        ] as const)
      : ([
          ["all", "All operations"],
          ["read", "Read only"],
        ] as const);
  const mode = selecting ? "pick" : access;
  return (
    <div className="tourtois-connection-access">
      <FactRow icon={<Sigil name="agent" />} label={agentName}>
        <label>
          <span className="sr-only">{`Access for ${agentName}`}</span>
          <select
            aria-label={`Access for ${agentName}`}
            value={mode}
            onChange={(event) => {
              const next = event.currentTarget.value;
              onChoose(next === "pick" ? [] : next === "read" ? "read" : "all");
            }}
          >
            {modes.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </FactRow>
      {selecting ? (
        tools.isPending ? (
          <p>Loading tools…</p>
        ) : tools.isError ? (
          <p role="alert">The tools could not be listed.</p>
        ) : (
          <CheckKeys>
            {tools.data.map((tool) => (
              <CheckKey
                key={tool}
                name={`${connection.connectionId}:${agentName}:${tool}`}
                label={tool}
                icon={<Sigil name="write" />}
                checked={access.includes(tool)}
                onChange={(event) => {
                  onChoose(
                    event.currentTarget.checked
                      ? [...access, tool]
                      : access.filter((name) => name !== tool),
                  );
                }}
              />
            ))}
          </CheckKeys>
        )
      ) : null}
    </div>
  );
}

const nameField = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/u,
    "Lowercase letters, digits and _, starting with a letter",
  )
  .meta(
    field({
      label: "Name",
      icon: <Sigil name="write" />,
      help: "The Agent calls its tools as env.mcp.<name>.",
      maxLength: 32,
      placeholder: "linear",
    }),
  );
const urlField = z
  .string()
  .max(2_048)
  .refine(
    (value) => URL.canParse(value) && new URL(value).protocol === "https:",
    "Use the server's https:// address",
  )
  .meta(
    field({
      label: "Server URL",
      icon: <Sigil name="internet" />,
      kind: "url",
      placeholder: "https://mcp.example.com/mcp",
    }),
  );
const bearerField = z
  .string()
  .max(4_096)
  .meta(
    field({
      label: "Bearer token",
      icon: <Sigil name="restricted" />,
      help: "Optional: only if the server asks for one.",
      kind: "secret",
    }),
  );

/** Add a connection; a host with no sign-in page offers a token or none. */
function AddConnection({
  onAdd,
  signIn,
}: {
  onAdd: (draft: ConnectionDraft) => Promise<void>;
  signIn: boolean;
}) {
  return signIn ? (
    <AddWithSignIn onAdd={onAdd} />
  ) : (
    <AddWithToken onAdd={onAdd} />
  );
}

function AddWithToken({
  onAdd,
}: {
  onAdd: (draft: ConnectionDraft) => Promise<void>;
}) {
  const schema = z.object({
    name: nameField,
    url: urlField,
    bearer: bearerField,
  });
  const add = useMutation({
    mutationFn: (draft: ConnectionDraft) => onAdd(draft),
  });
  const model = useSchemaForm({
    schema,
    defaultValues: { name: "", url: "", bearer: "" },
    onSubmit: async (value) => {
      try {
        await add.mutateAsync({
          name: value.name,
          url: value.url,
          bearer: value.bearer.length === 0 ? null : value.bearer,
        });
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "The connection could not be made.",
        };
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Add connection"
      disabled={add.isPending}
      footer={
        <FormFooter divider={false} error={model.error}>
          <Button type="submit">
            {add.isPending ? "Connecting…" : "Add connection"}
          </Button>
        </FormFooter>
      }
    />
  );
}

function AddWithSignIn({
  onAdd,
}: {
  onAdd: (draft: ConnectionDraft) => Promise<void>;
}) {
  const schema = z.object({
    name: nameField,
    url: urlField,
    bearer: bearerField,
    signIn: z.string().meta(
      field({
        label: "Authorization",
        icon: <Sigil name="restricted" />,
        kind: "select",
        options: {
          token: "Bearer token, or none",
          oauth: "Sign in with OAuth",
        },
      }),
    ),
    clientId: z
      .string()
      .max(512)
      .meta(
        field({
          label: "Client ID",
          icon: <Sigil name="write" />,
          help: "Optional: your own OAuth app. Otherwise the server registers one.",
        }),
      ),
    clientSecret: z
      .string()
      .max(4_096)
      .meta(
        field({
          label: "Client secret",
          icon: <Sigil name="restricted" />,
          help: "Optional: sealed by this host.",
          kind: "secret",
        }),
      ),
  });
  const add = useMutation({
    mutationFn: (draft: ConnectionDraft) => onAdd(draft),
  });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      name: "",
      url: "",
      bearer: "",
      signIn: "token",
      clientId: "",
      clientSecret: "",
    },
    onSubmit: async (value) => {
      try {
        const oauth = {
          clientId: value.clientId.length > 0 ? value.clientId : undefined,
          clientSecret:
            value.clientSecret.length > 0 ? value.clientSecret : undefined,
        };
        const draft: ConnectionDraft =
          value.signIn === "oauth"
            ? { name: value.name, url: value.url, bearer: null, oauth }
            : {
                name: value.name,
                url: value.url,
                bearer: value.bearer.length === 0 ? null : value.bearer,
              };
        await add.mutateAsync(draft);
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "The connection could not be made.",
        };
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Add connection"
      disabled={add.isPending}
      footer={
        <FormFooter divider={false} error={model.error}>
          <Button type="submit">
            {add.isPending ? "Connecting…" : "Add connection"}
          </Button>
        </FormFooter>
      }
    />
  );
}
