import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { Badge } from "@fungi.computer/caps/components/badge";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataListHeading,
  DataRow,
} from "@fungi.computer/caps/components/data-list";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { SchemaForm, field, useSchemaForm } from "@fungi.computer/caps/form";
import { Sigil } from "@fungi.computer/sigils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import * as z from "zod";

/** One connected MCP server as the host lists it; the token never comes back. */
const agentMcpServerSchema = z.strictObject({
  serverId: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  hasBearer: z.boolean(),
});
/** Every Agent with its connected MCP servers. */
export const agentMcpServersViewSchema = z.strictObject({
  agents: z.array(
    z.strictObject({
      agentId: z.string().min(1),
      name: z.string(),
      servers: z.array(agentMcpServerSchema),
    }),
  ),
});
export type AgentMcpServersView = z.output<typeof agentMcpServersViewSchema>;
/** What the owner submits to connect one server. */
export type AgentMcpServerDraft = Readonly<{
  name: string;
  url: string;
  bearer: string | null;
}>;
/** The host's owner-direct custody for Agent MCP servers. */
export type AgentMcpServersPort = Readonly<{
  list(): Promise<AgentMcpServersView>;
  add(agentId: string, draft: AgentMcpServerDraft): Promise<void>;
  remove(agentId: string, serverId: string): Promise<void>;
}>;

const queryKey = ["tourtois", "agent-mcp-servers"] as const;

/**
 * The Connectors settings on a standalone host: connect a remote MCP server to
 * an Agent. Its tools become `env.mcp.<name>.<tool>()` in that Agent's code.
 */
export function AgentMcpServers({ port }: { port: AgentMcpServersPort }) {
  const client = useQueryClient();
  const view = useQuery({ queryKey, queryFn: () => port.list() });
  const refresh = () => client.invalidateQueries({ queryKey });
  const remove = useMutation({
    mutationFn: (input: { agentId: string; serverId: string }) =>
      port.remove(input.agentId, input.serverId),
    onSuccess: refresh,
  });
  const agents = view.data?.agents ?? [];
  // A fresh form after each connected server, so the token field empties.
  const [formKey, setFormKey] = useState(0);
  return (
    <section
      className="tourtois-settings-content tourtois-connectors"
      aria-label="Connectors"
    >
      <SectionHeading>Connectors</SectionHeading>
      <p className="tourtois-settings-lede">
        Connect a remote MCP server to an Agent. Its tools become{" "}
        <code>env.mcp.&lt;name&gt;</code> in that Agent&apos;s code. A token
        stays with the Agent and is never shown again.
      </p>
      {view.isPending ? <p>Loading MCP servers…</p> : null}
      {view.isError ? (
        <div role="status">
          <p>MCP servers could not be loaded.</p>
          <Button size="sm" onClick={() => void view.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {view.isSuccess && agents.length === 0 ? (
        <p>Create an Agent first, then connect MCP servers to it.</p>
      ) : null}
      {agents.length > 0 ? (
        <>
          <DataList aria-label="Agent MCP servers">
            {agents.map((agent) => (
              <Fragment key={agent.agentId}>
                <DataListHeading>{agent.name}</DataListHeading>
                {agent.servers.length === 0 ? (
                  <DataRow>No MCP servers.</DataRow>
                ) : null}
                {agent.servers.map((server) => (
                  <DataRow key={server.serverId} className="p-0">
                    <ActionRow
                      icon={<Sigil name="connected" />}
                      label={
                        <>
                          {server.name}{" "}
                          <Badge size="sm" variant="quiet">
                            MCP
                          </Badge>
                        </>
                      }
                      description={server.url}
                      trailing={
                        <>
                          {server.hasBearer ? (
                            <Badge size="sm" variant="quiet">
                              Token saved
                            </Badge>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${server.name} from ${agent.name}`}
                            disabled={remove.isPending}
                            onClick={() => {
                              remove.mutate({
                                agentId: agent.agentId,
                                serverId: server.serverId,
                              });
                            }}
                          >
                            Remove
                          </Button>
                        </>
                      }
                    />
                  </DataRow>
                ))}
              </Fragment>
            ))}
          </DataList>
          {remove.isError ? (
            <p role="alert">The MCP server could not be removed.</p>
          ) : null}
          <AddMcpServer
            key={formKey}
            agents={agents}
            onAdd={async (agentId, draft) => {
              await port.add(agentId, draft);
              await refresh();
              setFormKey((current) => current + 1);
            }}
          />
        </>
      ) : null}
    </section>
  );
}

function AddMcpServer({
  agents,
  onAdd,
}: {
  agents: AgentMcpServersView["agents"];
  onAdd: (agentId: string, draft: AgentMcpServerDraft) => Promise<void>;
}) {
  const schema = useMemo(
    () =>
      z.object({
        agentId: z.string().meta(
          field({
            label: "Agent",
            kind: "select",
            options: Object.fromEntries(
              agents.map((agent) => [agent.agentId, agent.name]),
            ),
          }),
        ),
        name: z
          .string()
          .regex(
            /^[a-z][a-z0-9_]{0,31}$/u,
            "Lowercase letters, digits and _, starting with a letter",
          )
          .meta(
            field({
              label: "Name",
              help: "The Agent calls its tools as env.mcp.<name>.",
              maxLength: 32,
              placeholder: "linear",
            }),
          ),
        url: z
          .string()
          .max(2_048)
          .refine(
            (value) =>
              URL.canParse(value) && new URL(value).protocol === "https:",
            "Use the server's https:// address",
          )
          .meta(
            field({
              label: "Server URL",
              kind: "url",
              placeholder: "https://mcp.example.com/mcp",
            }),
          ),
        bearer: z
          .string()
          .max(4_096)
          .meta(
            field({
              label: "Bearer token",
              help: "Only if the server asks for one.",
              optional: true,
              kind: "secret",
            }),
          ),
      }),
    [agents],
  );
  const add = useMutation({
    mutationFn: (input: { agentId: string; draft: AgentMcpServerDraft }) =>
      onAdd(input.agentId, input.draft),
  });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      agentId: agents[0]?.agentId ?? "",
      name: "",
      url: "",
      bearer: "",
    },
    onSubmit: async (value) => {
      try {
        await add.mutateAsync({
          agentId: value.agentId,
          draft: {
            name: value.name,
            url: value.url,
            bearer: value.bearer.length === 0 ? null : value.bearer,
          },
        });
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "The MCP server could not be connected.",
        };
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      aria-label="Add MCP server"
      disabled={add.isPending}
      footer={
        <FormFooter error={model.error}>
          <Button type="submit">
            {add.isPending ? "Connecting…" : "Add MCP server"}
          </Button>
        </FormFooter>
      }
    />
  );
}
