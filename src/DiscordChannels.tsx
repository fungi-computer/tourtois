import { AppError } from "@fungi.computer/agar";
import {
  DataList,
  DataListHeading,
  DataRow,
  FactRow,
} from "@fungi.computer/caps/components/data-list";
import { Button } from "@fungi.computer/caps/components/button";
import { CopyField } from "@fungi.computer/caps/components/copy-field";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { InlineCode } from "@fungi.computer/caps/components/inline-code";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Prose } from "@fungi.computer/caps/components/prose";
import { Status } from "@fungi.computer/caps/components/status";
import {
  SchemaForm,
  field,
  sections,
  useSchemaForm,
} from "@fungi.computer/caps/form";
import { Sigil } from "@fungi.computer/sigils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as z from "zod";
import {
  websiteConversationSchema,
  websiteTranscriptSchema,
  type WebsiteConversation,
  type WebsiteTranscript,
} from "@fungi.computer/nacre/website-channels";
import { ChannelConversations } from "./ChannelConversations.js";
import { tourtoisQueryKeys } from "./queries.js";
import { requestIds } from "./team-directory.js";

/** An Agent a Discord application can be bound to. */
export type DiscordAgent = Readonly<{ agentId: string; name: string }>;

const snowflake = z.string().regex(/^\d{17,20}$/u);
const discordBindingWire = z.object({
  bindingId: z.string(),
  agentId: z.string(),
  selector: z.object({
    provider: z.literal("discord"),
    applicationId: snowflake,
    publicKey: z.string(),
    guildIds: z.array(snowflake),
    channelIds: z.array(snowflake),
  }),
  lifecycle: z.enum(["active", "suspended"]),
  authorityVersion: z.number().int().positive(),
  persona: z.string(),
});
/** One Discord application bound to an Agent; the bot token never comes back. */
export type DiscordBinding = z.infer<typeof discordBindingWire>;

/** Everything one host knows about its Discord applications. */
export type DiscordDirectory = Readonly<{
  /** The host's own address, where Discord posts its interactions. */
  interactionsOrigin: string;
  agents: readonly DiscordAgent[];
  bindings: readonly DiscordBinding[];
}>;

/** A new Discord application: its Agent, identity, token, places and brief. */
export type NewDiscord = Readonly<{
  agentId: string;
  applicationId: string;
  publicKey: string;
  botToken: string;
  guildIds: readonly string[];
  channelIds: readonly string[];
  persona: string;
}>;

/** What an owner may change about one Discord application. */
export type DiscordChange = Readonly<{
  lifecycle?: "active" | "suspended";
  botToken?: string;
}>;

/** Which guilds took `/ask` and which Discord refused. */
export type DiscordCommandResult = Readonly<{
  registered: readonly string[];
  failed: readonly string[];
}>;

/** Host-supplied owner controls over its Discord applications. */
export type DiscordChannelsPort = Readonly<{
  /** Names this host's data; two hosts never share a cache entry. */
  scope: string;
  read(): Promise<DiscordDirectory>;
  create(input: NewDiscord, requestId: string): Promise<DiscordBinding>;
  update(
    bindingId: string,
    expectedVersion: number,
    change: DiscordChange,
  ): Promise<DiscordBinding>;
  registerCommands(bindingId: string): Promise<DiscordCommandResult>;
  conversations(
    binding: DiscordBinding,
  ): Promise<readonly WebsiteConversation[]>;
  transcript(
    binding: DiscordBinding,
    sessionId: string,
  ): Promise<WebsiteTranscript>;
  /** Replies the Agent owed this application's members and could not deliver. */
  undelivered(binding: DiscordBinding): Promise<readonly DiscordUndelivered[]>;
}>;

/** One reply that never reached Discord; the member is named, never numbered. */
export type DiscordUndelivered = Readonly<{
  interactionId: string;
  label: string;
  state: "expired" | "failed";
  closedAt: number;
}>;

/** What the owner typed in an id list, read the way the host will. */
type DiscordIds =
  { kind: "parsed"; ids: string[] } | { kind: "invalid"; message: string };

function parseIds(text: string, what: string, least: number): DiscordIds {
  const entries = text.split(/[\s,]+/u).filter(Boolean);
  if (entries.length < least)
    return { kind: "invalid", message: `Enter at least one ${what} ID.` };
  const ids: string[] = [];
  for (const entry of entries) {
    if (!snowflake.safeParse(entry).success)
      return {
        kind: "invalid",
        message: `“${entry}” is not a Discord ID. It is 17 to 20 digits.`,
      };
    if (!ids.includes(entry)) ids.push(entry);
  }
  return { kind: "parsed", ids };
}

const directoryWire = z.object({
  interactionsOrigin: z.url(),
  agents: z.array(z.object({ agentId: z.string(), name: z.string() })),
  discords: z.array(discordBindingWire),
});
const bindingChange = z.object({ binding: discordBindingWire });
const commandResult = z.object({
  registered: z.array(snowflake),
  failed: z.array(snowflake),
});
const decodeRefusal = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.String })),
);

const undeliveredList = z.object({
  undelivered: z.array(
    z.object({
      interactionId: z.string(),
      label: z.string(),
      state: z.enum(["expired", "failed"]),
      closedAt: z.number(),
    }),
  ),
});
const conversationList = z.object({
  conversations: z.array(websiteConversationSchema),
});

const refusalText = new Map([
  ["application_taken", "That Discord application is already bound."],
  ["not_found", "That Agent or Discord application was not found."],
  ["version_conflict", "It changed elsewhere. Reload, then try again."],
  ["invalid_input", "Check the IDs, key and bot token, then try again."],
  [
    "custody_unavailable",
    "This Oyster has no credential key, so it cannot store a bot token.",
  ],
  ["limit", "This Oyster holds as many sealed credentials as it can."],
]);

/** The owner-readable reason a refusal body names, if it names one we know. */
async function refusalOf(response: Response): Promise<string | undefined> {
  const decoded = decodeRefusal(await response.text());
  return Option.isSome(decoded)
    ? refusalText.get(decoded.value.error)
    : undefined;
}

async function request(url: URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(init?.headers)),
    },
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) {
    throw new AppError(
      (await refusalOf(response)) ??
        `Discord request refused (${String(response.status)}).`,
      {
        code:
          response.status === 401 || response.status === 403
            ? "CAPABILITY_DENIED"
            : "HOST_FAILURE",
        retryable: response.status >= 500,
      },
    );
  }
  return response;
}

/** Bind owner Discord controls to this trusted shell's own host. */
export function createOysterDiscordChannelsPort(
  origin: URL,
): DiscordChannelsPort {
  const send = (path: string, init?: RequestInit) =>
    request(new URL(path, origin), init);
  const binding = (bindingId: string) =>
    `/api/discord/${encodeURIComponent(bindingId)}`;
  return {
    scope: origin.origin,
    read: async () => {
      const wire = directoryWire.parse(
        await (await send("/api/discord")).json(),
      );
      return {
        interactionsOrigin: wire.interactionsOrigin,
        agents: wire.agents,
        bindings: wire.discords,
      };
    },
    create: async (input, requestId) => {
      const response = await send("/api/discord", {
        method: "POST",
        headers: { "x-request-id": requestId },
        body: JSON.stringify(input),
      });
      return bindingChange.parse(await response.json()).binding;
    },
    update: async (bindingId, expectedVersion, change) => {
      const response = await send(binding(bindingId), {
        method: "PUT",
        body: JSON.stringify({ expectedVersion, ...change }),
      });
      return bindingChange.parse(await response.json()).binding;
    },
    registerCommands: async (bindingId) =>
      commandResult.parse(
        await (
          await send(`${binding(bindingId)}/commands`, { method: "POST" })
        ).json(),
      ),
    conversations: async ({ bindingId }) =>
      conversationList.parse(
        await (await send(`${binding(bindingId)}/conversations`)).json(),
      ).conversations,
    undelivered: async ({ bindingId }) =>
      undeliveredList.parse(
        await (await send(`${binding(bindingId)}/undelivered`)).json(),
      ).undelivered,
    transcript: async ({ bindingId }, sessionId) =>
      websiteTranscriptSchema.parse(
        await (
          await send(
            `${binding(bindingId)}/conversations/${encodeURIComponent(sessionId)}`,
          )
        ).json(),
      ),
  };
}

const portalUrl = "https://discord.com/developers/applications";

/**
 * Owner Settings for Discord: bring your own Discord application, choose the
 * Agent members talk to, add `/ask` to your servers and pause it. Sits under
 * the Website section of Channels, in the same shape.
 */
export function DiscordChannels({ port }: { port: DiscordChannelsPort }) {
  const directory = useQuery({
    queryKey: tourtoisQueryKeys.discordChannels(port.scope),
    retry: false,
    queryFn: () => port.read(),
  });
  const [adding, setAdding] = useState(false);
  const [createdBinding, setCreatedBinding] = useState<string | null>(null);
  const [openBinding, setOpenBinding] = useState<string | null>(null);
  const agents = directory.data?.agents ?? [];
  return (
    <section className="tourtois-websites grid gap-md" aria-label="Discord">
      <header className="grid gap-xs">
        <DataListHeading level={3}>Discord</DataListHeading>
        <p className="text-sm">
          Let people in your Discord server talk to one of your Agents. You
          bring your own Discord application; Fungi holds no Discord account.
          Members type <InlineCode>/ask</InlineCode>, and the Agent answers in
          the channel.
        </p>
      </header>
      {directory.isPending ? <p role="status">Loading Discord…</p> : null}
      {directory.isError ? (
        <div role="alert">
          <p>
            Discord could not be loaded. Your saved settings have not changed.
          </p>
          <Button
            onClick={() => {
              void directory.refetch();
            }}
          >
            Retry Discord
          </Button>
        </div>
      ) : null}
      {directory.data ? (
        <>
          {directory.data.bindings.length > 0 ? (
            <DataList aria-label="Saved Discord applications">
              {directory.data.bindings.map((binding) => (
                <DiscordRow
                  key={binding.bindingId}
                  port={port}
                  binding={binding}
                  interactionsOrigin={directory.data.interactionsOrigin}
                  open={openBinding === binding.bindingId}
                  justCreated={createdBinding === binding.bindingId}
                  onOpenChange={(open) => {
                    setOpenBinding(open ? binding.bindingId : null);
                  }}
                  agentName={
                    agents.find((agent) => agent.agentId === binding.agentId)
                      ?.name ?? "Unavailable Agent"
                  }
                />
              ))}
            </DataList>
          ) : adding ? null : (
            <p className="text-sm">No Discord applications yet.</p>
          )}
          {adding ? (
            <AddDiscord
              port={port}
              agents={agents}
              onDone={(bindingId) => {
                setAdding(false);
                if (bindingId) {
                  setOpenBinding(bindingId);
                  setCreatedBinding(bindingId);
                }
              }}
            />
          ) : agents.length === 0 ? (
            <p className="text-sm">
              Create an Agent first; Discord needs one to answer members.
            </p>
          ) : (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setAdding(true);
                }}
              >
                Add Discord
              </Button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function AddDiscord({
  port,
  agents,
  onDone,
}: {
  port: DiscordChannelsPort;
  agents: readonly DiscordAgent[];
  onDone: (bindingId: string | null) => void;
}) {
  const cache = useQueryClient();
  const schema = useMemo(
    () =>
      z
        .object({
          agentId: z.string().meta(
            field({
              label: "Agent",
              help: "Members talk to this Agent.",
              kind: "select",
              section: "discord",
              options: Object.fromEntries(
                agents.map((agent) => [agent.agentId, agent.name]),
              ),
            }),
          ),
          applicationId: snowflake.meta(
            field({
              label: "Application ID",
              help: "From General Information in the Discord developer portal.",
              placeholder: "1234567890123456789",
              required: true,
              section: "discord",
            }),
          ),
          publicKey: z
            .string()
            .regex(/^[0-9a-fA-F]{64}$/u, "Paste the 64-character public key")
            .meta(
              field({
                label: "Public key",
                help: "Also on General Information. Discord signs every request with it.",
                required: true,
                section: "discord",
              }),
            ),
          botToken: z
            .string()
            .min(1, "Paste the bot token")
            .max(256)
            .meta(
              field({
                label: "Bot token",
                icon: <Sigil name="restricted" />,
                help: "From Bot in the developer portal. Sealed on this instance and never shown again.",
                kind: "secret",
                required: true,
                section: "discord",
              }),
            ),
          guilds: z
            .string()
            .transform((text, context) => {
              const parsed = parseIds(text, "server", 1);
              if (parsed.kind === "parsed") return parsed.ids;
              context.addIssue({ code: "custom", message: parsed.message });
              return z.NEVER;
            })
            .meta(
              field({
                label: "Server IDs",
                help: "Turn on Developer Mode in Discord, then right-click your server and Copy Server ID. Separate more than one with commas.",
                placeholder: "2345678901234567890",
                required: true,
                section: "discord",
              }),
            ),
          channels: z
            .string()
            .transform((text, context) => {
              const parsed = parseIds(text, "channel", 0);
              if (parsed.kind === "parsed") return parsed.ids;
              context.addIssue({ code: "custom", message: parsed.message });
              return z.NEVER;
            })
            .meta(
              field({
                label: "Channel IDs",
                help: "Leave empty to answer in every channel of those servers.",
                optional: true,
                section: "discord",
              }),
            ),
          persona: z
            .string()
            .max(4_000)
            .meta(
              field({
                label: "What should the Agent do here?",
                help: "Its brief for Discord. Members don't see it.",
                kind: "textarea",
                optional: true,
                rows: 3,
                maxLength: 4_000,
                placeholder: "Answer questions about our community.",
                section: "discord",
              }),
            ),
        })
        .meta(
          sections({
            discord: {
              title: "Add a Discord application",
              description:
                "Create an application in the Discord developer portal, add its bot to your server, then paste its details here. You get the address to give Discord next.",
            },
          }),
        ),
    [agents],
  );
  const create = useMutation({
    mutationFn: (input: { requestId: string } & NewDiscord) =>
      port.create(
        {
          agentId: input.agentId,
          applicationId: input.applicationId,
          publicKey: input.publicKey,
          botToken: input.botToken,
          guildIds: input.guildIds,
          channelIds: input.channelIds,
          persona: input.persona,
        },
        input.requestId,
      ),
    onSuccess: async (binding) => {
      await cache.invalidateQueries({
        queryKey: tourtoisQueryKeys.discordChannels(port.scope),
      });
      onDone(binding.bindingId);
    },
  });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      agentId: agents[0]?.agentId ?? "",
      applicationId: "",
      publicKey: "",
      botToken: "",
      guilds: "",
      channels: "",
      persona: "",
    },
    onSubmit: async (value) => {
      try {
        await create.mutateAsync({
          requestId: requestIds.request.generate(),
          agentId: value.agentId,
          applicationId: value.applicationId,
          publicKey: value.publicKey,
          botToken: value.botToken,
          guildIds: value.guilds,
          channelIds: value.channels,
          persona: value.persona,
        });
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "Discord could not be added. Try the saved request again.",
        };
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Add a Discord application"
      disabled={create.isPending}
      footer={
        <FormFooter error={create.error?.message ?? model.error}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onDone(null);
            }}
          >
            Cancel
          </Button>
          {create.isError ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                create.mutate(create.variables);
              }}
            >
              Retry saved request
            </Button>
          ) : null}
          <Button type="submit">
            {create.isPending ? "Adding Discord…" : "Add Discord"}
          </Button>
        </FormFooter>
      }
    />
  );
}

function DiscordRow({
  port,
  binding,
  interactionsOrigin,
  agentName,
  open,
  justCreated,
  onOpenChange,
}: {
  port: DiscordChannelsPort;
  binding: DiscordBinding;
  interactionsOrigin: string;
  agentName: string;
  open: boolean;
  justCreated: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cache = useQueryClient();
  const guideId = useId();
  const key = tourtoisQueryKeys.discordChannels(port.scope);
  const patch = useMutation({
    // Edits queue per application; each sends the last version the host acknowledged.
    scope: { id: JSON.stringify([port.scope, binding.bindingId]) },
    mutationFn: (change: DiscordChange) => {
      const current = cache
        .getQueryData<DiscordDirectory>(key)
        ?.bindings.find((item) => item.bindingId === binding.bindingId);
      if (!current)
        throw new Error("Discord unavailable. Reload before changing it.");
      return port.update(binding.bindingId, current.authorityVersion, change);
    },
    onSettled: () => cache.invalidateQueries({ queryKey: key }),
  });
  const register = useMutation({
    mutationFn: () => port.registerCommands(binding.bindingId),
  });
  const { applicationId, guildIds, channelIds } = binding.selector;
  const endpoint = `${interactionsOrigin}/api/discord/interactions/${binding.bindingId}`;
  const active = binding.lifecycle === "active";
  const places =
    channelIds.length === 0
      ? `all channels in ${String(guildIds.length)} ${guildIds.length === 1 ? "server" : "servers"}`
      : `${String(channelIds.length)} ${channelIds.length === 1 ? "channel" : "channels"}`;
  return (
    <DataRow>
      <div className="tourtois-connector-row grid gap-md">
        <div className="tourtois-website-summary">
          <Sigil name="agent" size={28} />
          <div className="min-w-0 flex-1">
            <DataListHeading level={3}>{agentName}</DataListHeading>
            <p className="tourtois-website-hosts text-sm">{places}</p>
          </div>
          <Status
            appearance="chip"
            label={active ? "Active" : "Paused"}
            size="compact"
            tone={active ? "success" : "neutral"}
          />
          <Button
            variant="outline"
            size="sm"
            aria-controls={guideId}
            aria-expanded={open}
            aria-label={`${open ? "Close" : "Set up"} ${agentName} on Discord`}
            onClick={() => {
              onOpenChange(!open);
            }}
          >
            {open ? "Close" : "Set up"}
          </Button>
        </div>
        {open ? (
          <div
            className="tourtois-connector-row-details tourtois-website-guide"
            id={guideId}
          >
            <Prose className="tourtois-website-doc">
              <h4>
                {justCreated ? "Finish setting up Discord" : "Connect Discord"}
              </h4>
              <ol>
                <li>
                  <p>
                    <strong>Copy this address.</strong> In the{" "}
                    <a href={portalUrl}>Discord developer portal</a>, open your
                    application, paste it into Interactions Endpoint URL on
                    General Information and save. Discord checks it at once.
                  </p>
                  <CopyField
                    layout="block"
                    title="URL"
                    label="Copy address"
                    tokens={[{ kind: "string", text: endpoint }]}
                    aria-label={`Interactions endpoint for ${agentName}`}
                  />
                </li>
                <li>
                  <p>
                    <strong>Add the bot to your server</strong> from OAuth2 in
                    the portal, with the <InlineCode>bot</InlineCode> and{" "}
                    <InlineCode>applications.commands</InlineCode> scopes. It
                    needs no other permission.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Add the command.</strong> This puts{" "}
                    <InlineCode>/ask</InlineCode> in your server.
                  </p>
                  <span className="tourtois-website-fact">
                    <KeycapButton
                      density="compact"
                      label={
                        register.isPending
                          ? "Adding /ask…"
                          : "Add /ask to Discord"
                      }
                      disabled={register.isPending}
                      onClick={() => {
                        register.mutate();
                      }}
                    />
                    {register.data ? (
                      <Status
                        glyph="dot"
                        tone={
                          register.data.failed.length === 0
                            ? "success"
                            : "warning"
                        }
                        label={
                          register.data.failed.length === 0
                            ? `Added to ${String(register.data.registered.length)} ${register.data.registered.length === 1 ? "server" : "servers"}`
                            : `Discord refused ${String(register.data.failed.length)} of ${String(register.data.failed.length + register.data.registered.length)}. Check the bot is in that server.`
                        }
                      />
                    ) : null}
                  </span>
                </li>
                <li>
                  <p>
                    <strong>Try it.</strong> Type <InlineCode>/ask</InlineCode>{" "}
                    in a channel. {agentName} answers there, with a Reply button
                    to carry on.
                  </p>
                </li>
              </ol>
              <h4>What members can trigger</h4>
              <p>
                Members talk to {agentName} itself, with {agentName}’s own tools
                and permissions. They cannot sign in to this Oyster or reach
                your account. The server and channel list limits where it
                answers, not who can use it there.
              </p>
            </Prose>
            <DataList
              density="compact"
              aria-label={`Discord status for ${agentName}`}
            >
              <FactRow icon={<Sigil name="agent" />} label="Agent">
                {agentName}
              </FactRow>
              <FactRow icon={<Sigil name="internet" />} label="Application ID">
                <InlineCode>{applicationId}</InlineCode>
              </FactRow>
              <FactRow
                icon={<Sigil name="chat" />}
                label={active ? "Discord is live" : "Discord is paused"}
              >
                <span className="tourtois-website-fact">
                  <span className="text-sm">
                    {active
                      ? "Pause to stop answering without removing the setup."
                      : "Members get a notice until you resume it."}
                  </span>
                  <KeycapButton
                    density="compact"
                    label={active ? "Pause Discord" : "Resume Discord"}
                    disabled={patch.isPending}
                    onClick={() => {
                      patch.mutate({
                        lifecycle: active ? "suspended" : "active",
                      });
                    }}
                  />
                </span>
              </FactRow>
            </DataList>
            {patch.isError ? <p role="alert">{patch.error.message}</p> : null}
            {register.isError ? (
              <p role="alert">{register.error.message}</p>
            ) : null}
            <ChannelConversations
              keys={{
                list: tourtoisQueryKeys.discordConversations(
                  port.scope,
                  binding.bindingId,
                ),
                transcript: (sessionId) =>
                  tourtoisQueryKeys.discordTranscript(
                    port.scope,
                    binding.bindingId,
                    sessionId,
                  ),
              }}
              load={() => port.conversations(binding)}
              read={(sessionId) => port.transcript(binding, sessionId)}
              problems={{
                key: tourtoisQueryKeys.discordUndelivered(
                  port.scope,
                  binding.bindingId,
                ),
                load: async () =>
                  (await port.undelivered(binding)).map((reply) => ({
                    id: reply.interactionId,
                    label: reply.label,
                    at: reply.closedAt,
                    reason:
                      reply.state === "failed"
                        ? "Discord kept refusing the answer, so it never arrived."
                        : "The answer was not ready before Discord's reply window closed.",
                  })),
              }}
              speaker="Member"
              empty="No one has asked yet."
              label="Discord conversations"
            />
          </div>
        ) : null}
      </div>
    </DataRow>
  );
}
