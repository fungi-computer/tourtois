import { AppError } from "@fungi.computer/agar";
import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import { CopyField } from "@fungi.computer/caps/components/copy-field";
import {
  DataList,
  DataListHeading,
  DataRow,
  FactRow,
} from "@fungi.computer/caps/components/data-list";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { CheckKey } from "@fungi.computer/caps/components/icon-checkbox";
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
import {
  webOriginProblem,
  webOriginSchema,
  websiteConversationSchema,
  websiteSiteSchema,
  websiteTranscriptSchema,
  type WebOriginProblem,
  type WebsiteConversation,
  type WebsiteSite,
  type WebsiteTranscript,
} from "@fungi.computer/nacre/website-channels";
import { Sigil } from "@fungi.computer/sigils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, type ReactNode } from "react";
import * as z from "zod";
import { ChannelConversations } from "./ChannelConversations.js";
import { tourtoisQueryKeys } from "./queries.js";
import { requestIds } from "./team-directory.js";

export type { WebsiteConversation, WebsiteSite, WebsiteTranscript };

/** An Agent a website can be bound to. */
export type WebsiteAgent = Readonly<{ agentId: string; name: string }>;

/** Everything one host knows about its websites. */
export type WebsiteDirectory = Readonly<{
  /** The host's own address, where the launcher and visitor API are served. */
  embedOrigin: string;
  agents: readonly WebsiteAgent[];
  sites: readonly WebsiteSite[];
}>;

/** What an owner may change about one website. */
export type WebsiteChange = Readonly<{
  lifecycle?: "active" | "suspended";
  turnstile?: boolean;
  rotateSiteKey?: true;
}>;

/** A new website: the Agent visitors talk to, where it appears and its brief. */
export type NewWebsite = Readonly<{
  agentId: string;
  origins: readonly string[];
  persona: string;
}>;

/** Host-supplied owner controls over its websites, not a second inventory. */
export type WebsiteChannelsPort = Readonly<{
  /** Names this host's data; two hosts never share a cache entry. */
  scope: string;
  read(): Promise<WebsiteDirectory>;
  create(input: NewWebsite, requestId: string): Promise<WebsiteSite>;
  update(
    bindingId: string,
    expectedVersion: number,
    change: WebsiteChange,
  ): Promise<WebsiteSite>;
  conversations(site: WebsiteSite): Promise<readonly WebsiteConversation[]>;
  transcript(site: WebsiteSite, sessionId: string): Promise<WebsiteTranscript>;
}>;

const exampleAddress = "https://example.com";

/** What the owner typed in the address field, read the way the host will. */
export type WebsiteAddresses =
  { kind: "parsed"; origins: string[] } | { kind: "invalid"; message: string };

/**
 * Read the owner's typed addresses, then run the web origin schema on each.
 * Settings only forgives typing: a bare host gains `https://` and a lone
 * trailing `/` is dropped, so a pasted home-page link works. Anything the
 * schema refuses is named on the field instead of sent.
 */
export function parseWebsiteAddresses(text: string): WebsiteAddresses {
  const entries = text.split(/[\s,]+/u).filter(Boolean);
  if (entries.length === 0)
    return {
      kind: "invalid",
      message: `Enter your website's address, like ${exampleAddress}.`,
    };
  if (entries.length > 16)
    return { kind: "invalid", message: "Add up to 16 addresses." };
  const origins: string[] = [];
  for (const entry of entries) {
    const typed = entry.includes("://") ? entry : `https://${entry}`;
    const result = webOriginSchema.safeParse(
      typed.replace(/(?<=[^/])\/$/u, ""),
    );
    if (!result.success)
      return {
        kind: "invalid",
        message: addressProblem(entry, webOriginProblem(result.error)),
      };
    if (!origins.includes(result.data)) origins.push(result.data);
  }
  return { kind: "parsed", origins };
}

function addressProblem(entry: string, problem: WebOriginProblem) {
  switch (problem) {
    case "insecure":
      return "Use https:// — the chat only runs on secure websites.";
    case "credentials":
      return `Leave the sign-in out of “${entry}”.`;
    case "path":
      return `Use just the website, without a page or query, like ${exampleAddress}.`;
    case "tooLong":
      return "That address is too long.";
    case "notUrl":
    case "notAllowed":
      return `“${entry}” is not a web address. Try ${exampleAddress}.`;
  }
}

/** The loader tag an owner pastes, as coloured runs; joined, they are the tag. */
export function websiteEmbedSnippet(embedOrigin: string, siteKey: string) {
  return [
    { kind: "tag", text: "<script" },
    { kind: "text", text: "\n  " },
    { kind: "attribute", text: "src" },
    { kind: "tag", text: "=" },
    { kind: "string", text: `"${embedOrigin}/embed/v1.js"` },
    { kind: "text", text: "\n  " },
    { kind: "attribute", text: "data-site" },
    { kind: "tag", text: "=" },
    { kind: "string", text: `"${siteKey}"` },
    { kind: "text", text: "\n  " },
    { kind: "attribute", text: "data-theme" },
    { kind: "tag", text: "=" },
    { kind: "string", text: '"auto"' },
    { kind: "text", text: "\n  " },
    { kind: "attribute", text: "async" },
    { kind: "text", text: "\n" },
    { kind: "tag", text: "></script>" },
  ] as const;
}

const directoryWire = z.object({
  embedOrigin: z.url(),
  agents: z.array(z.object({ agentId: z.string(), name: z.string() })),
  websites: z.array(websiteSiteSchema),
});
const siteChange = z.object({ binding: websiteSiteSchema });
const conversationList = z.object({
  conversations: z.array(websiteConversationSchema),
});

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
  if (!response.ok)
    throw new AppError(
      `Website request refused (${String(response.status)}).`,
      {
        code:
          response.status === 401 || response.status === 403
            ? "CAPABILITY_DENIED"
            : "HOST_FAILURE",
        retryable: response.status >= 500,
      },
    );
  return response;
}

/** Bind owner website controls to this trusted shell's own host. */
export function createOysterWebsiteChannelsPort(
  origin: URL,
): WebsiteChannelsPort {
  const send = (path: string, init?: RequestInit) =>
    request(new URL(path, origin), init);
  const site = (bindingId: string) =>
    `/api/websites/${encodeURIComponent(bindingId)}`;
  return {
    scope: origin.origin,
    read: async () => {
      const wire = directoryWire.parse(
        await (await send("/api/websites")).json(),
      );
      return {
        embedOrigin: wire.embedOrigin,
        agents: wire.agents,
        sites: wire.websites,
      };
    },
    create: async (input, requestId) => {
      const response = await send("/api/websites", {
        method: "POST",
        headers: { "x-request-id": requestId },
        body: JSON.stringify({
          agentId: input.agentId,
          selector: { provider: "web", origins: input.origins },
          persona: input.persona,
        }),
      });
      return siteChange.parse(await response.json()).binding;
    },
    update: async (bindingId, expectedVersion, change) => {
      const response = await send(site(bindingId), {
        method: "PUT",
        body: JSON.stringify({ expectedVersion, ...change }),
      });
      return siteChange.parse(await response.json()).binding;
    },
    conversations: async ({ bindingId }) =>
      conversationList.parse(
        await (await send(`${site(bindingId)}/conversations`)).json(),
      ).conversations,
    transcript: async ({ bindingId }, sessionId) =>
      websiteTranscriptSchema.parse(
        await (
          await send(
            `${site(bindingId)}/conversations/${encodeURIComponent(sessionId)}`,
          )
        ).json(),
      ),
  };
}

/** Host copy that differs by what a visitor can reach. */
export type WebsiteChannelsCopy = Readonly<{
  /** Opening paragraphs under the heading. */
  intro: ReactNode;
  /** What a visitor sees and what limits apply, for one Agent. */
  visitors: (agentName: string) => ReactNode;
  /** What a visitor's chat can trigger, for one Agent. */
  reach: (agentName: string) => ReactNode;
}>;

const siteHost = (origin: string) => origin.replace(/^https?:\/\//u, "");

/**
 * Owner Settings for website chat: bind an Agent to a website, copy the code
 * to paste there, pause it, require a security check, change its site key and
 * read what visitors said. Hosts supply the port and the copy that differs.
 */
export function WebsiteChannels({
  port,
  copy,
  assistant,
  siteNotice,
  children,
}: {
  port: WebsiteChannelsPort;
  copy: WebsiteChannelsCopy;
  /** A host's own way to make the first Agent; absent means create one in Agents. */
  assistant?: (done: () => void, cancel: () => void) => ReactNode;
  /** A host's note under one website, such as an Agent delivery state. */
  siteNotice?: (site: WebsiteSite) => ReactNode;
  /** Further sections the host keeps under the websites. */
  children?: ReactNode;
}) {
  const directory = useQuery({
    queryKey: tourtoisQueryKeys.websiteChannels(port.scope),
    retry: false,
    queryFn: () => port.read(),
  });
  const [adding, setAdding] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);
  const [guided, setGuided] = useState(false);
  const [createdSite, setCreatedSite] = useState<string | null>(null);
  const [openSite, setOpenSite] = useState<string | null>(null);
  const agents = directory.data?.agents ?? [];
  return (
    <section
      className="tourtois-settings-content tourtois-websites grid gap-md"
      aria-label="Channels"
    >
      <header className="grid gap-xs">
        <SectionHeading>Channels</SectionHeading>
        <DataListHeading level={3}>Website</DataListHeading>
        {copy.intro}
      </header>
      {directory.isPending ? <p role="status">Loading Channels…</p> : null}
      {directory.isError ? (
        <div role="alert">
          <p>
            Channels could not be loaded. Your saved settings have not changed.
          </p>
          <Button
            onClick={() => {
              void directory.refetch();
            }}
          >
            Retry Channels
          </Button>
        </div>
      ) : null}
      {directory.data ? (
        <>
          {directory.data.sites.length > 0 ? (
            <DataList aria-label="Saved websites">
              {directory.data.sites.map((site) => (
                <WebsiteRow
                  key={site.bindingId}
                  port={port}
                  copy={copy}
                  site={site}
                  notice={siteNotice?.(site)}
                  embedOrigin={directory.data.embedOrigin}
                  open={openSite === site.bindingId}
                  justCreated={createdSite === site.bindingId}
                  onOpenChange={(open) => {
                    setOpenSite(open ? site.bindingId : null);
                  }}
                  agentName={
                    agents.find((agent) => agent.agentId === site.agentId)
                      ?.name ?? "Unavailable Agent"
                  }
                />
              ))}
            </DataList>
          ) : adding ? null : (
            <p className="text-sm">No websites yet.</p>
          )}
          {creatingAssistant && assistant !== undefined ? (
            assistant(
              () => {
                // The new Agent must be in the list the form chooses from.
                void directory.refetch().then(() => {
                  setCreatingAssistant(false);
                  setAdding(true);
                });
              },
              () => {
                setCreatingAssistant(false);
                setGuided(false);
              },
            )
          ) : adding ? (
            <AddWebsite
              port={port}
              agents={agents}
              guided={guided}
              onDone={(bindingId) => {
                setAdding(false);
                setGuided(false);
                if (bindingId) {
                  setOpenSite(bindingId);
                  setCreatedSite(bindingId);
                }
              }}
            />
          ) : agents.length === 0 && assistant === undefined ? (
            <p className="text-sm">
              Create an Agent first; a website needs one to talk to visitors.
            </p>
          ) : (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  if (agents.length === 0) {
                    setCreatingAssistant(true);
                    setGuided(true);
                  } else setAdding(true);
                }}
              >
                {agents.length === 0
                  ? "Set up a website assistant"
                  : "Add website"}
              </Button>
            </div>
          )}
        </>
      ) : null}
      {children}
    </section>
  );
}

function AddWebsite({
  port,
  agents,
  guided,
  onDone,
}: {
  port: WebsiteChannelsPort;
  agents: readonly WebsiteAgent[];
  guided: boolean;
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
              help: "Visitors chat with this Agent.",
              kind: "select",
              section: "website",
              options: Object.fromEntries(
                agents.map((agent) => [agent.agentId, agent.name]),
              ),
            }),
          ),
          addresses: z
            .string()
            .transform((text, context) => {
              const parsed = parseWebsiteAddresses(text);
              if (parsed.kind === "parsed") return parsed.origins;
              context.addIssue({ code: "custom", message: parsed.message });
              return z.NEVER;
            })
            .meta(
              field({
                label: "Website address",
                help: "Starts with https://. Separate more than one with commas.",
                kind: "url",
                autoComplete: "url",
                placeholder: "https://example.com",
                required: true,
                section: "website",
              }),
            ),
          persona: z
            .string()
            .max(4_000)
            .meta(
              field({
                label: "What should the Agent do here?",
                help: "Its brief for this website. Visitors don't see it.",
                kind: "textarea",
                optional: true,
                rows: 3,
                maxLength: 4_000,
                placeholder: "Answer questions about our services.",
                section: "website",
              }),
            ),
        })
        .meta(
          sections({
            website: {
              title: guided
                ? "2. Add your website and instructions"
                : "Add a website",
              description:
                "Use the address visitors open, including https and www. Add facts such as shop hours and delivery rules; the assistant does not read your pages automatically. You get the code to paste next.",
            },
          }),
        ),
    [agents, guided],
  );
  const create = useMutation({
    mutationFn: (input: { requestId: string } & NewWebsite) =>
      port.create(
        {
          agentId: input.agentId,
          origins: input.origins,
          persona: input.persona,
        },
        input.requestId,
      ),
    onSuccess: async (site) => {
      await cache.invalidateQueries({
        queryKey: tourtoisQueryKeys.websiteChannels(port.scope),
      });
      onDone(site.bindingId);
    },
  });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      agentId: agents[0]?.agentId ?? "",
      addresses: "",
      persona: "",
    },
    onSubmit: async (value) => {
      try {
        await create.mutateAsync({
          requestId: requestIds.request.generate(),
          agentId: value.agentId,
          origins: value.addresses,
          persona: value.persona,
        });
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "The website could not be added. Try the saved request again.",
        };
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Add a website"
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
            {create.isPending ? "Adding website…" : "Add website"}
          </Button>
        </FormFooter>
      }
    />
  );
}

function WebsiteRow({
  port,
  copy,
  site,
  notice,
  embedOrigin,
  agentName,
  open,
  justCreated,
  onOpenChange,
}: {
  port: WebsiteChannelsPort;
  copy: WebsiteChannelsCopy;
  site: WebsiteSite;
  notice: ReactNode;
  embedOrigin: string;
  agentName: string;
  open: boolean;
  justCreated: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cache = useQueryClient();
  const guideId = useId();
  const key = tourtoisQueryKeys.websiteChannels(port.scope);
  const [confirmingKey, setConfirmingKey] = useState(false);
  const patch = useMutation({
    // Edits queue per website; each sends the last version the host acknowledged.
    scope: { id: JSON.stringify([port.scope, site.bindingId]) },
    mutationFn: (change: WebsiteChange) => {
      const current = cache
        .getQueryData<WebsiteDirectory>(key)
        ?.sites.find((item) => item.bindingId === site.bindingId);
      if (!current)
        throw new Error("Website unavailable. Reload before changing it.");
      return port.update(site.bindingId, current.authorityVersion, change);
    },
    onSettled: () => cache.invalidateQueries({ queryKey: key }),
  });
  const { origins, siteKey, turnstile } = site.selector;
  const snippet = websiteEmbedSnippet(embedOrigin, siteKey);
  const active = site.lifecycle === "active";
  const hosts = origins.map(siteHost).join(", ");
  return (
    <DataRow>
      <div className="tourtois-connector-row grid gap-md">
        <div className="tourtois-website-summary">
          <Sigil name="agent" size={28} />
          <div className="min-w-0 flex-1">
            <DataListHeading level={3}>{agentName}</DataListHeading>
            <p className="tourtois-website-hosts text-sm">{hosts}</p>
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
            aria-label={`${open ? "Close" : "Set up"} ${agentName} on ${hosts}`}
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
                {justCreated
                  ? "3. Install and test chat"
                  : "Add it to your website"}
              </h4>
              <ol>
                <li>
                  <p>
                    <strong>Copy this code.</strong>
                  </p>
                  <CopyField
                    layout="block"
                    title="HTML"
                    label="Copy snippet"
                    tokens={snippet}
                    aria-label={`Embed snippet for ${agentName}`}
                  />
                </li>
                <li>
                  <p>
                    <strong>
                      Paste it into your pages, just before{" "}
                      <InlineCode>{"</body>"}</InlineCode>.
                    </strong>{" "}
                    If your site has a shared layout, template or footer, paste
                    it there once. Site builders call this “custom code” or
                    “footer code”.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Publish, then open your site.</strong> A chat button
                    appears in the bottom-right corner. Open it and send a
                    message; {agentName} replies.
                  </p>
                </li>
              </ol>
              <details>
                <summary>WordPress installation steps</summary>
                <ol>
                  <li>
                    In WordPress, open Pages and edit the page where you want
                    chat. Add a Custom HTML block: type /html and press Enter.
                  </li>
                  <li>
                    Open Edit HTML and choose the HTML tab. Paste the whole
                    copied code, including the script tags. Choose Update.
                  </li>
                  <li>
                    Save or publish the page, then open its public address in a
                    private browser window and send a test message.
                  </li>
                </ol>
                <p>
                  A Custom HTML block adds chat to only this page. For every
                  page, use your host’s shared footer-code setting or the WPCode
                  plugin’s Header &amp; Footer screen.
                </p>
                <p>
                  If WordPress removes the script when you save, ask your site
                  administrator to install it. Some accounts cannot save
                  scripts. You do not need a plugin when your account can save
                  the Custom HTML block.
                </p>
                <p>
                  <a href="https://docs.fungi.computer/guides/wordpress-agent/">
                    Full WordPress guide
                  </a>
                </p>
              </details>
              <p className="tourtois-website-note">
                The chat only appears on{" "}
                {origins.map((origin, index) => (
                  <span key={origin}>
                    {index > 0 ? ", " : null}
                    <InlineCode>{origin}</InlineCode>
                  </span>
                ))}
                . To try it somewhere else first, add that address as another
                website.
              </p>
              <h4>What visitors see</h4>
              <p>{copy.visitors(agentName)}</p>
              <h4>What visitors can trigger</h4>
              <p>{copy.reach(agentName)}</p>
            </Prose>
            <DataList
              density="compact"
              aria-label={`Website status for ${agentName}`}
            >
              <FactRow icon={<Sigil name="agent" />} label="Agent">
                {agentName}
              </FactRow>
              <FactRow icon={<Sigil name="internet" />} label="Site key">
                <InlineCode>{siteKey}</InlineCode>
              </FactRow>
              <FactRow
                icon={<Sigil name="chat" />}
                label={active ? "Chat is live" : "Chat is paused"}
              >
                <span className="tourtois-website-fact">
                  <span className="text-sm">
                    {active
                      ? "Pause to stop new messages without removing the code."
                      : "Visitors can’t send messages until you resume it."}
                  </span>
                  <KeycapButton
                    density="compact"
                    label={active ? "Pause website" : "Resume website"}
                    disabled={patch.isPending}
                    onClick={() => {
                      patch.mutate({
                        lifecycle: active ? "suspended" : "active",
                      });
                    }}
                  />
                </span>
              </FactRow>
              <FactRow
                icon={<Sigil name="restricted" />}
                label="Security check"
              >
                <CheckKey
                  label="Require a security check"
                  hint="Visitors pass a Cloudflare Turnstile check before they can chat. This host needs its Turnstile keys."
                  checked={turnstile === true}
                  disabled={patch.isPending}
                  onChange={(event) => {
                    patch.mutate({ turnstile: event.currentTarget.checked });
                  }}
                />
              </FactRow>
              <FactRow icon={<Sigil name="loop" />} label="New site key">
                <span className="tourtois-website-fact">
                  <span className="text-sm">
                    Make a new key if the old code leaked. The code on your
                    website stops working until you paste the new one.
                  </span>
                  {confirmingKey ? (
                    <span className="flex flex-wrap items-center gap-sm">
                      <Status
                        glyph="dot"
                        label="This replaces the key now"
                        tone="warning"
                      />
                      <KeycapButton
                        density="compact"
                        label="Make a new key"
                        tone="destructive"
                        disabled={patch.isPending}
                        onClick={() => {
                          patch.mutate({ rotateSiteKey: true });
                          setConfirmingKey(false);
                        }}
                      />
                      <KeycapButton
                        density="compact"
                        label="Keep this key"
                        onClick={() => {
                          setConfirmingKey(false);
                        }}
                      />
                    </span>
                  ) : (
                    <KeycapButton
                      density="compact"
                      label="New site key"
                      disabled={patch.isPending}
                      onClick={() => {
                        setConfirmingKey(true);
                      }}
                    />
                  )}
                </span>
              </FactRow>
            </DataList>
            {notice}
            {patch.isError ? <p role="alert">{patch.error.message}</p> : null}
            <ChannelConversations
              keys={{
                list: tourtoisQueryKeys.websiteConversations(
                  port.scope,
                  site.bindingId,
                ),
                transcript: (sessionId) =>
                  tourtoisQueryKeys.websiteTranscript(
                    port.scope,
                    site.bindingId,
                    sessionId,
                  ),
              }}
              load={() => port.conversations(site)}
              read={(sessionId) => port.transcript(site, sessionId)}
              speaker="Visitor"
              empty="No visitor has written yet."
              label="Website conversations"
            />
          </div>
        ) : null}
      </div>
    </DataRow>
  );
}
