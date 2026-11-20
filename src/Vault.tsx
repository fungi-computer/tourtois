import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataRow,
  FactRow,
} from "@fungi.computer/caps/components/data-list";
import {
  Field,
  FieldSet,
  FormFooter,
} from "@fungi.computer/caps/components/field";
import { Checkbox } from "@fungi.computer/caps/components/checkbox";
import { Input } from "@fungi.computer/caps/components/input";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Select } from "@fungi.computer/caps/components/select";
import { Status } from "@fungi.computer/caps/components/status";
import { toast } from "@fungi.computer/caps/components/toaster";
import {
  FormField,
  FormFields,
  SchemaForm,
  field,
  useSchemaForm,
  type FieldRenderProps,
} from "@fungi.computer/caps/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import * as z from "zod";
import { WORKBENCH_NOTICES } from "./app-toast.js";
import { SettingsItem } from "./settings-item.js";

const methods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;
const methodSchema = z.enum(methods);
export type VaultMethod = z.output<typeof methodSchema>;

/** One site a secret is bound to: an exact host, a path and its methods. */
const destinationSchema = z.strictObject({
  host: z.string().min(1).max(253),
  pathPrefix: z.string().max(2048).optional(),
  methods: z.array(methodSchema).min(1).max(7),
});
export type VaultDestination = z.output<typeof destinationSchema>;
/** One through eight rules per secret (adr-vault-v1). */
const destinationLimit = 8;

/** Where the value goes on the way out. The host places it; nobody reads it. */
const placementSchema = z.union([
  z.literal("bearer"),
  z.literal("basic"),
  z.strictObject({ header: z.string().min(1).max(64) }),
  z.strictObject({ query: z.string().min(1).max(64) }),
]);
export type VaultPlacement = z.output<typeof placementSchema>;

/** Who may use a stored value: the broker's principal vocabulary. */
const subjectSchema = z.strictObject({
  kind: z.enum(["agent", "computer", "app", "team-key"]),
  id: z.string().min(1),
});
export type VaultSubject = z.output<typeof subjectSchema>;
/** What the page can scope a secret to. Apps hold no Vault power. */
type ScopeKind = "agent" | "computer";

/** One stored credential as the owner lists it. No value, ever. */
const credentialSchema = z.strictObject({
  connectionId: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  /** A secret bound to destinations, or the Connection that holds it. */
  kind: z.enum(["secret", "mcp", "openapi"]),
  origin: z.string(),
  destinations: z.array(destinationSchema).nullable(),
  /** A pasted value, a sign-in's tokens, or nothing yet. */
  credential: z.enum(["value", "sign-in", "none"]),
  placement: placementSchema.nullable(),
  state: z.enum(["pending", "active", "reconnect_required"]),
  version: z.number().int().positive(),
  subjects: z.array(subjectSchema),
});
export type VaultCredential = z.output<typeof credentialSchema>;

/** One stored model key as the owner lists it. The key never comes back. */
const modelKeySchema = z.strictObject({
  keyId: z.string().min(1),
  provider: z.string().min(1),
  label: z.string().min(1),
  /** A Team key, or a key that serves only the member who added it. */
  scope: z.enum(["user", "team"]),
  createdAt: z.number().nonnegative(),
  /** The server an OpenAI-compatible key calls; null for a named provider. */
  baseUrl: z.string().nullable(),
});
export type VaultModelKey = z.output<typeof modelKeySchema>;

/** A provider the host offers; the host owns the list. */
const providerSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Cloudflare Workers AI needs the account its token belongs to. */
  accountId: z.boolean(),
  /** An OpenAI-compatible server names where it runs. */
  baseUrl: z.boolean(),
});

/**
 * Everything one owner holds, as the page shows it: model keys and
 * Connection credentials together, what the viewer may manage, and the
 * Agents and Computers a secret can be scoped to. No value appears.
 */
export const vaultViewSchema = z.strictObject({
  /** The host's Vault authority, for display; the server still decides. */
  role: z.strictObject({
    /** Team secrets, Connection credentials and Team model keys. */
    manageTeam: z.boolean(),
    /** The viewer's own model keys. */
    managePersonal: z.boolean(),
  }),
  /** Stored values Sessions cannot scrub yet; rotating one protects it. */
  coverage: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("complete") }),
    z.strictObject({
      state: z.literal("incomplete"),
      missing: z.array(
        z.strictObject({
          kind: z.enum(["model-key", "connection"]),
          id: z.string().min(1),
        }),
      ),
    }),
  ]),
  providers: z.array(providerSchema).min(1),
  /** The model-key scopes this host offers. */
  scopes: z.array(z.enum(["user", "team"])).min(1),
  modelKeys: z.array(modelKeySchema),
  credentials: z.array(credentialSchema),
  subjects: z.strictObject({
    agents: z.array(
      z.strictObject({ id: z.string().min(1), name: z.string() }),
    ),
    computers: z.array(
      z.strictObject({ id: z.string().min(1), name: z.string() }),
    ),
  }),
});
export type VaultView = z.output<typeof vaultViewSchema>;

/** One audited use: who, where and how it went. Never the value or path. */
export type VaultUse = Readonly<{
  subject: VaultSubject | null;
  /** The bound host the request went to; null for a model call. */
  host: string | null;
  method: string | null;
  outcome:
    | "placed"
    | "refused_destination"
    | "refused_grant"
    | "upstream_status"
    | "failed";
  status: number | null;
  count: number;
  lastAt: number;
}>;

/** A new secret: its name, the sites it is bound to and its value. */
export type VaultSecretDraft = Readonly<{
  name: string;
  label?: string;
  destinations: readonly VaultDestination[];
  placement: VaultPlacement;
  secret: string;
}>;
/** A write-only change to a stored credential. */
export type VaultCredentialChange = Readonly<{
  expectedVersion: number;
  label?: string;
  destinations?: readonly VaultDestination[];
  secret?: string;
}>;
/** What the owner submits to store one model key. */
export type VaultModelKeyDraft = Readonly<{
  provider: string;
  scope: "user" | "team";
  label: string;
  apiKey: string;
  /** Only for a provider that asks for one. */
  accountId: string | undefined;
  /** Only for a provider that runs on the owner's own server. */
  baseUrl: string | undefined;
}>;

const agentChoiceSchema = z.strictObject({
  keySource: z.enum(["workers-ai", "ai-gateway", "byok"]),
  keyId: z.string().min(1).optional(),
  model: z.strictObject({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    reasoning: z.string().optional(),
  }),
});
/** Every Agent with its persisted model choice, and the models each key offers. */
export const agentModelsViewSchema = z.strictObject({
  models: z.enum(["ready", "missing", "unknown"]),
  catalogs: z.partialRecord(
    z.string().min(1),
    z.array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string().min(1),
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        tools: z.boolean(),
      }),
    ),
  ),
  agents: z.array(
    z.strictObject({
      agentId: z.string().min(1),
      name: z.string(),
      choice: agentChoiceSchema.nullable(),
    }),
  ),
});
export type AgentModelsView = z.output<typeof agentModelsViewSchema>;
/** The Agent's next model: the instance default, or a stored key's provider. */
export type AgentModelChoiceDraft =
  | Readonly<{ keyId: null }>
  | Readonly<{ keyId: string; provider: string; modelId: string }>;

/**
 * The host's owner door for everything it holds in custody. Values travel in
 * on these calls and never come back out. Methods a host lacks are absent and
 * the page offers no control for them; the server still decides each call.
 */
export type VaultPort = Readonly<{
  read(): Promise<VaultView>;
  addSecret(draft: VaultSecretDraft): Promise<void>;
  updateCredential(
    connectionId: string,
    change: VaultCredentialChange,
  ): Promise<void>;
  /** A secret is revoked whole; a Connection only loses its value. */
  revokeCredential(
    connectionId: string,
    expectedVersion: number,
  ): Promise<void>;
  grant(connectionId: string, subject: VaultSubject): Promise<void>;
  ungrant(connectionId: string, subject: VaultSubject): Promise<void>;
  credentialUsage(connectionId: string): Promise<readonly VaultUse[]>;
  modelKeys: Readonly<{
    add(draft: VaultModelKeyDraft): Promise<void>;
    remove(keyId: string): Promise<void>;
    /** Replace a key's value in place; its Agent choices stay. */
    rotate?(keyId: string, apiKey: string): Promise<void>;
    usage?(keyId: string): Promise<readonly VaultUse[]>;
  }>;
  /** Which model each Agent runs on, where this host lets the page choose. */
  agentModels?: Readonly<{
    read(): Promise<AgentModelsView>;
    choose(agentId: string, draft: AgentModelChoiceDraft): Promise<void>;
  }>;
}>;

const vaultQueryKey = ["tourtois", "vault"] as const;

/** What the Vault is, in the one sentence pair every host opens it with. */
export const vaultLede =
  "Every key and credential your Agents use, in one place. A value goes in once and is never shown again, to you or to an Agent.";
const defaultSource = "default";

const providerLabel = (providers: VaultView["providers"], id: string) =>
  providers.find((choice) => choice.id === id)?.label ?? id;

/**
 * A host's refusal, already a sentence the owner can act on. Anything else a
 * port throws is shown as the page's own fallback, never as host detail.
 */
export class VaultRefusal extends Error {
  constructor(sentence: string, options?: ErrorOptions) {
    super(sentence, options);
    this.name = "VaultRefusal";
  }
}

const failure = (cause: unknown, fallback: string) =>
  cause instanceof VaultRefusal ? cause.message : fallback;

const dateText = (at: number) =>
  new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const timeText = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const placementText = (placement: VaultPlacement | null) =>
  placement === null
    ? null
    : placement === "bearer"
      ? "Bearer token"
      : placement === "basic"
        ? "Basic sign-in"
        : "header" in placement
          ? `${placement.header} header`
          : `?${placement.query}`;

const destinationText = (destination: VaultDestination) =>
  `${destination.host}${destination.pathPrefix ?? ""} · ${destination.methods.join(", ")}`;

function plural(count: number, one: string, many: string) {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function subjectsText(subjects: readonly VaultSubject[], connection: boolean) {
  const agents = subjects.filter((subject) => subject.kind === "agent").length;
  const computers = subjects.filter(
    (subject) => subject.kind === "computer",
  ).length;
  const parts = [
    agents > 0 ? plural(agents, "Agent", "Agents") : null,
    computers > 0 ? plural(computers, "Computer", "Computers") : null,
  ].filter((part) => part !== null);
  if (parts.length > 0) return `Used by ${parts.join(", ")}`;
  return connection ? "No Agent has it yet" : "Nobody can use it yet";
}

/** One choice in a short multi-select: a Caps checkbox and its name. */
function Choice({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="tourtois-vault-choice">
      <Checkbox checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

/** A section's title at the shared left edge, its explanation under it. */
function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <header className="tourtois-vault-section-head">
      <SectionHeading className="tourtois-vault-section-title">
        {title}
      </SectionHeading>
      <p className="tourtois-vault-note">{note}</p>
    </header>
  );
}

/**
 * The add form under a list: closed behind its opener until asked for, and
 * always open while the list is empty. Opening moves focus to the first field.
 */
function AddDisclosure({
  label,
  empty,
  initiallyOpen = false,
  children,
}: {
  label: string;
  empty: boolean;
  /** Setup arrives to add one, so the form starts open. */
  initiallyOpen?: boolean;
  children: (close: (() => void) | undefined) => ReactNode;
}) {
  const [asked, setAsked] = useState(initiallyOpen);
  const [focusFirst, setFocusFirst] = useState(false);
  const into = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null || !focusFirst) return;
      node
        .querySelector<HTMLElement>(
          "input:not([type=hidden]), select, textarea",
        )
        ?.focus();
      setFocusFirst(false);
    },
    [focusFirst],
  );
  if (!asked && !empty)
    return (
      <div className="tourtois-vault-add">
        <KeycapButton
          density="compact"
          label={label}
          aria-expanded={false}
          onClick={() => {
            setAsked(true);
            setFocusFirst(true);
          }}
        />
      </div>
    );
  return (
    <div ref={into} className="tourtois-vault-add-form">
      {children(
        empty
          ? undefined
          : () => {
              setAsked(false);
            },
      )}
    </div>
  );
}

/**
 * A value field with no way to show what was typed: a write-only password
 * input. The Vault never offers a reveal, even of the draft.
 */
function writeOnly(props: FieldRenderProps<string>) {
  return (
    <Input
      id={props.id}
      name={props.name}
      type="password"
      autoComplete="off"
      spellCheck={false}
      className="caps-field-secret"
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      disabled={props.disabled}
      value={props.value}
      onBlur={props.onBlur}
      onChange={(event) => {
        props.onChange(event.currentTarget.value);
      }}
    />
  );
}

/**
 * Vault: every key and credential this owner holds, in one place. Add one,
 * replace its value, choose where and by whom it may be used, revoke it and
 * see each use. A value goes in once and is never shown again.
 */
export function Vault({
  port,
  focus = false,
  toasterId = WORKBENCH_NOTICES,
  heading = true,
}: {
  port: VaultPort;
  /** Open on the model-key form, as a setup step that needs a model does. */
  focus?: boolean;
  /** The toaster this page's notices go to. */
  toasterId?: string;
  /** False where the host's own page header already names the Vault. */
  heading?: boolean;
}) {
  const client = useQueryClient();
  const view = useQuery({
    queryKey: vaultQueryKey,
    queryFn: () => port.read(),
  });
  const status = view.status;
  const focusSetup = useCallback(
    (section: HTMLElement | null) => {
      if (!focus || status === "pending") return;
      section
        ?.querySelector<HTMLElement>(
          "[aria-label='Add model key'] select, [aria-label='Add model key'] input",
        )
        ?.focus();
    },
    [focus, status],
  );
  const refresh = () => client.invalidateQueries({ queryKey: vaultQueryKey });
  const notice = useMemo(
    () => ({
      error: (message: string) => {
        toast.error(message, { toasterId });
      },
      done: (message: string) => {
        toast.success(message, { toasterId });
      },
    }),
    [toasterId],
  );
  const data = view.data;
  return (
    <section
      ref={focusSetup}
      className="tourtois-settings-stack tourtois-vault"
      aria-label="Vault"
    >
      {heading ? (
        <>
          <SectionHeading>Vault</SectionHeading>
          <p className="tourtois-settings-lede">{vaultLede}</p>
        </>
      ) : null}
      {view.isPending ? (
        <p role="status" className="tourtois-settings-empty">
          Loading the Vault…
        </p>
      ) : null}
      {view.isError ? (
        <div role="alert" className="tourtois-settings-notice">
          <Status glyph="dot" tone="error" size="compact" />
          <p>The Vault could not be loaded.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void view.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {data !== undefined ? (
        <>
          {data.coverage.state === "incomplete" &&
          data.coverage.missing.length > 0 ? (
            <div role="status" className="tourtois-vault-coverage">
              <Status glyph="dot" tone="warning" size="compact" />
              <p>
                {plural(
                  data.coverage.missing.length,
                  "value was",
                  "values were",
                )}{" "}
                stored before transcripts were scrubbed. Replace{" "}
                {data.coverage.missing.length === 1 ? "it" : "each one"} to
                protect it.
              </p>
            </div>
          ) : null}
          <ModelKeys
            port={port}
            setup={focus}
            view={data}
            notice={notice}
            refresh={refresh}
          />
          {port.agentModels !== undefined ? (
            <AgentModels port={port.agentModels} view={data} notice={notice} />
          ) : null}
          <Secrets port={port} view={data} notice={notice} refresh={refresh} />
          <ConnectionCredentials
            port={port}
            view={data}
            notice={notice}
            refresh={refresh}
          />
        </>
      ) : null}
    </section>
  );
}

type Notice = Readonly<{
  error: (message: string) => void;
  done: (message: string) => void;
}>;
type Panel = "rotate" | "scope" | "usage" | "revoke";

const unprotected = (
  view: VaultView,
  kind: "model-key" | "connection",
  id: string,
) =>
  view.coverage.state === "incomplete" &&
  view.coverage.missing.some((item) => item.kind === kind && item.id === id);

function UnprotectedMark() {
  return (
    <Status
      appearance="chip"
      glyph="dot"
      tone="warning"
      size="compact"
      label="Replace to protect"
    />
  );
}

function ModelKeys({
  port,
  setup,
  view,
  notice,
  refresh,
}: {
  port: VaultPort;
  /** Opened from model setup: the add form starts open. */
  setup: boolean;
  view: VaultView;
  notice: Notice;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState<{ keyId: string; panel: Panel } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const may = (scope: "user" | "team") =>
    scope === "team" ? view.role.manageTeam : view.role.managePersonal;
  const scopes = view.scopes.filter(may);
  // A fresh form after each stored key, so the key field empties.
  const [formKey, setFormKey] = useState(0);
  const toggle = (keyId: string, panel: Panel) => {
    setOpen((current) =>
      current?.keyId === keyId && current.panel === panel
        ? null
        : { keyId, panel },
    );
  };
  return (
    <section className="tourtois-settings-stack" aria-label="Model keys">
      <SectionHead
        title="Model keys"
        note="The provider keys your Agents chat on. Each is checked with its provider when you add it."
      />
      <DataList density="compact" aria-label="Model keys">
        {view.modelKeys.length === 0 ? (
          <DataRow className="tourtois-settings-empty">
            No model keys yet. Agents use the default model until you add one.
          </DataRow>
        ) : null}
        {view.modelKeys.map((key) => {
          const manage = may(key.scope);
          const panel = open?.keyId === key.keyId ? open.panel : null;
          return (
            <DataRow key={key.keyId}>
              <div className="tourtois-vault-item">
                <SettingsItem
                  title={key.label}
                  detail={
                    <>
                      <p>
                        {providerLabel(view.providers, key.provider)}
                        {view.scopes.length > 1
                          ? key.scope === "team"
                            ? " · Team"
                            : " · Just you"
                          : ""}
                        {" · Added "}
                        {dateText(key.createdAt)}
                      </p>
                      {key.baseUrl !== null ? (
                        <p className="tourtois-vault-mono">{key.baseUrl}</p>
                      ) : null}
                      {unprotected(view, "model-key", key.keyId) ? (
                        <p>
                          <UnprotectedMark />
                        </p>
                      ) : null}
                    </>
                  }
                  actions={
                    <>
                      {manage && port.modelKeys.rotate !== undefined ? (
                        <KeycapButton
                          density="compact"
                          label="Rotate"
                          aria-label={`Rotate ${key.label}`}
                          aria-expanded={panel === "rotate"}
                          disabled={busy}
                          onClick={() => {
                            toggle(key.keyId, "rotate");
                          }}
                        />
                      ) : null}
                      {port.modelKeys.usage !== undefined ? (
                        <KeycapButton
                          density="compact"
                          label="Usage"
                          aria-label={`Usage of ${key.label}`}
                          aria-expanded={panel === "usage"}
                          onClick={() => {
                            toggle(key.keyId, "usage");
                          }}
                        />
                      ) : null}
                      {manage ? (
                        <KeycapButton
                          density="compact"
                          tone="destructive"
                          label="Remove"
                          aria-label={`Remove ${key.label}`}
                          aria-expanded={panel === "revoke"}
                          disabled={busy}
                          onClick={() => {
                            toggle(key.keyId, "revoke");
                          }}
                        />
                      ) : null}
                    </>
                  }
                />
                {panel === "rotate" && port.modelKeys.rotate !== undefined ? (
                  <RotatePanel
                    name={key.label}
                    hint="Agents that run on this key keep it. The old value stops working here at once."
                    onCancel={() => {
                      setOpen(null);
                    }}
                    onRotate={async (value) => {
                      await port.modelKeys.rotate?.(key.keyId, value);
                      setOpen(null);
                      notice.done(`${key.label} now uses the new value.`);
                      await refresh();
                    }}
                    notice={notice}
                  />
                ) : null}
                {panel === "usage" && port.modelKeys.usage !== undefined ? (
                  <UsagePanel
                    name={key.label}
                    queryKey={[...vaultQueryKey, "usage", "model", key.keyId]}
                    read={() =>
                      port.modelKeys.usage?.(key.keyId) ?? Promise.resolve([])
                    }
                    view={view}
                  />
                ) : null}
                {panel === "revoke" ? (
                  <RevokePanel
                    name={key.label}
                    action="Remove"
                    consequence="Agents that run on this key stop replying until they get another."
                    disabled={busy}
                    onCancel={() => {
                      setOpen(null);
                    }}
                    onConfirm={async () => {
                      setBusy(true);
                      try {
                        await port.modelKeys.remove(key.keyId);
                        setOpen(null);
                        notice.done(`${key.label} was removed.`);
                        await refresh();
                      } catch (cause) {
                        console.error("Model key removal failed", cause);
                        notice.error(
                          failure(cause, "The model key could not be removed."),
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                ) : null}
              </div>
            </DataRow>
          );
        })}
      </DataList>
      {scopes.length > 0 ? (
        <AddDisclosure
          key={formKey}
          label="Add model key"
          empty={view.modelKeys.length === 0}
          initiallyOpen={setup && formKey === 0}
        >
          {(close) => (
            <AddModelKey
              providers={view.providers}
              offered={view.scopes}
              scopes={scopes}
              notice={notice}
              onCancel={close}
              onAdd={async (draft) => {
                await port.modelKeys.add(draft);
                await refresh();
                notice.done(`${draft.label} was checked and stored.`);
                setFormKey((current) => current + 1);
              }}
            />
          )}
        </AddDisclosure>
      ) : (
        <p className="tourtois-settings-note">
          Only Team owners and admins can add model keys here.
        </p>
      )}
    </section>
  );
}

function AddModelKey({
  providers,
  offered,
  scopes,
  notice,
  onCancel,
  onAdd,
}: {
  providers: VaultView["providers"];
  /** The scopes this host offers; the viewer may manage only `scopes`. */
  offered: VaultView["scopes"];
  scopes: readonly ("user" | "team")[];
  notice: Notice;
  /** Absent while the form is the only way forward (an empty list). */
  onCancel: (() => void) | undefined;
  onAdd: (draft: VaultModelKeyDraft) => Promise<void>;
}) {
  const choice = (id: string) => providers.find((item) => item.id === id);
  const schema = useMemo(
    () =>
      z.object({
        provider: z.string().meta(
          field({
            label: "Provider",
            kind: "select",
            options: Object.fromEntries(
              providers.map((item) => [item.id, item.label]),
            ),
          }),
        ),
        scope: z.enum(["user", "team"]).meta(
          field({
            label: "Who can use it",
            kind: "radio",
            options: {
              user: {
                label: "Just me",
                description: "Only you and your own Agents.",
                disabled: !scopes.includes("user"),
              },
              team: {
                label: "The whole Team",
                description: "Every Agent in this Team.",
                disabled: !scopes.includes("team"),
              },
            },
          }),
        ),
        label: z
          .string()
          .trim()
          .min(1, "Name this key")
          .max(64)
          .meta(
            field({
              label: "Name",
              maxLength: 64,
              placeholder: "Work key",
            }),
          ),
        accountId: z
          .string()
          .max(32)
          .meta(
            field({
              label: "Account ID",
              help: "Find this in your Cloudflare dashboard. The token needs Workers AI access for this account.",
              maxLength: 32,
            }),
          ),
        baseUrl: z
          .string()
          .max(2048)
          .meta(
            field({
              label: "Base URL",
              placeholder: "https://llm.example.com/v1",
            }),
          ),
        apiKey: z
          .string()
          .min(1, "Paste the key")
          .max(16_384)
          .meta(
            field({
              label: "API key",
              help: "Checked with the provider, then never shown again.",
              render: writeOnly,
            }),
          ),
      }),
    [providers, scopes],
  );
  const [pending, setPending] = useState(false);
  const blank = {
    provider: providers[0]?.id ?? "",
    scope: scopes[0] ?? "user",
    label: "",
    accountId: "",
    baseUrl: "",
    apiKey: "",
  };
  const model = useSchemaForm({
    schema,
    defaultValues: blank,
    onSubmit: async (value) => {
      const provider = choice(value.provider);
      if (
        provider?.accountId === true &&
        !/^[a-f0-9]{32}$/u.test(value.accountId)
      )
        return {
          kind: "refused",
          fields: {
            accountId: "Enter your 32-character Cloudflare account ID.",
          },
        };
      if (provider?.baseUrl === true && !URL.canParse(value.baseUrl))
        return {
          kind: "refused",
          fields: { baseUrl: "Enter the server's https:// address." },
        };
      setPending(true);
      try {
        await onAdd({
          provider: value.provider,
          scope: value.scope,
          label: value.label,
          apiKey: value.apiKey,
          accountId: provider?.accountId === true ? value.accountId : undefined,
          baseUrl: provider?.baseUrl === true ? value.baseUrl : undefined,
        });
        return { kind: "saved", values: blank };
      } catch (cause) {
        notice.error(failure(cause, "The model key could not be stored."));
        return { kind: "refused" };
      } finally {
        setPending(false);
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Add model key"
      disabled={pending}
      footer={
        <FormFooter divider={false}>
          {onCancel === undefined ? null : (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Add model key"}
          </Button>
        </FormFooter>
      }
    >
      <model.form.Subscribe selector={(state) => state.values.provider}>
        {(provider) => (
          <FormFields
            model={model}
            names={[
              "provider",
              ...(offered.length > 1 ? (["scope"] as const) : []),
              "label",
              ...(choice(provider)?.accountId === true
                ? (["accountId"] as const)
                : []),
              ...(choice(provider)?.baseUrl === true
                ? (["baseUrl"] as const)
                : []),
              "apiKey",
            ]}
            layout="columns"
          />
        )}
      </model.form.Subscribe>
    </SchemaForm>
  );
}

function AgentModels({
  port,
  view,
  notice,
}: {
  port: NonNullable<VaultPort["agentModels"]>;
  view: VaultView;
  notice: Notice;
}) {
  const client = useQueryClient();
  const queryKey = [...vaultQueryKey, "agent-models"] as const;
  const models = useQuery({ queryKey, queryFn: () => port.read() });
  const keys = view.modelKeys;
  const data = models.data;
  return (
    <section className="tourtois-settings-stack" aria-label="Agent models">
      <SectionHead
        title="Agent models"
        note="The model each Agent chats on, and the key it runs on."
      />
      {models.isError ? (
        <div role="alert" className="tourtois-settings-notice">
          <Status glyph="dot" tone="error" size="compact" />
          <p>Agent models could not be loaded.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void models.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {data?.models === "missing" ? (
        <p role="status" className="tourtois-settings-note">
          No model is connected yet. The instance default cannot reply until you
          add a model key.
        </p>
      ) : null}
      {data !== undefined ? (
        <>
          <DataList density="compact" aria-label="Agent models">
            {data.agents.length === 0 ? (
              <DataRow className="tourtois-settings-empty">
                Create an Agent first.
              </DataRow>
            ) : null}
            {data.agents.map((agent) => {
              const selectedKey = keys.find(
                (key) => key.keyId === agent.choice?.keyId,
              );
              const catalog = Object.entries(data.catalogs).find(
                ([provider]) => provider === agent.choice?.model.providerId,
              )?.[1];
              const name = catalog?.find(
                (item) => item.id === agent.choice?.model.modelId,
              )?.name;
              const disconnected =
                data.models === "missing" ||
                (agent.choice?.keySource === "byok" &&
                  selectedKey === undefined);
              return (
                <FactRow key={agent.agentId} label={agent.name}>
                  {disconnected
                    ? "Not connected"
                    : agent.choice === null
                      ? "Unavailable"
                      : (name ??
                        (catalog === undefined
                          ? agent.choice.model.modelId
                          : "Model unavailable for tools"))}
                  {disconnected || selectedKey === undefined
                    ? ""
                    : ` · ${selectedKey.label}`}
                </FactRow>
              );
            })}
          </DataList>
          {data.agents.length > 0 ? (
            <ChooseAgentModel
              key={keys.map((key) => key.keyId).join(":")}
              agents={data.agents}
              keys={keys}
              providers={view.providers}
              catalogs={data.catalogs}
              models={data.models}
              onChoose={async (agentId, draft) => {
                try {
                  await port.choose(agentId, draft);
                  await client.invalidateQueries({ queryKey });
                  notice.done("The Agent's model was saved.");
                  return true;
                } catch (cause) {
                  notice.error(failure(cause, "The model could not be saved."));
                  return false;
                }
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ChooseAgentModel({
  agents,
  keys,
  providers,
  catalogs,
  models,
  onChoose,
}: {
  agents: AgentModelsView["agents"];
  keys: VaultView["modelKeys"];
  providers: VaultView["providers"];
  catalogs: AgentModelsView["catalogs"];
  models: AgentModelsView["models"];
  onChoose: (agentId: string, draft: AgentModelChoiceDraft) => Promise<boolean>;
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
        source: z.string(),
        modelId: z.string(),
      }),
    [agents],
  );
  const [pending, setPending] = useState(false);
  const model = useSchemaForm({
    schema,
    defaultValues: {
      agentId: agents[0]?.agentId ?? "",
      source: keys[0]?.keyId ?? defaultSource,
      modelId: "",
    },
    onSubmit: async (value) => {
      const key = keys.find((item) => item.keyId === value.source);
      if (value.source !== defaultSource && key === undefined)
        return { kind: "refused", fields: { source: "Choose a stored key." } };
      const available = key === undefined ? [] : (catalogs[key.provider] ?? []);
      const modelId = value.modelId || available.find((item) => item.tools)?.id;
      if (key !== undefined && !available.some((item) => item.id === modelId))
        return {
          kind: "refused",
          fields: { modelId: "Choose a supported model for this key." },
        };
      setPending(true);
      try {
        const saved = await onChoose(
          value.agentId,
          key === undefined
            ? { keyId: null }
            : {
                keyId: key.keyId,
                provider: key.provider,
                modelId: modelId ?? "",
              },
        );
        return saved ? { kind: "saved" } : { kind: "refused" };
      } finally {
        setPending(false);
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Choose Agent model"
      disabled={pending}
      footer={
        <FormFooter divider={false}>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save model"}
          </Button>
        </FormFooter>
      }
    >
      <FormFields model={model} names={["agentId"]} />
      <FormField form={model.form} name="source" label="Runs on">
        {(source) => (
          <Select
            name="source"
            value={source.state.value}
            onChange={(event) => {
              source.handleChange(event.target.value);
              model.form.setFieldValue("modelId", "");
            }}
          >
            <option value={defaultSource}>
              {models === "missing"
                ? "Instance default — not connected"
                : "Instance default model"}
            </option>
            {keys.map((key) => (
              <option key={key.keyId} value={key.keyId}>
                {key.label} ({providerLabel(providers, key.provider)})
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <model.form.Subscribe selector={(state) => state.values.source}>
        {(source) => {
          const key = keys.find((item) => item.keyId === source);
          if (key === undefined) return null;
          const available = catalogs[key.provider] ?? [];
          return (
            <FormField
              form={model.form}
              name="modelId"
              label="Model"
              description="Choose tools for work in Apps. Other models may not use tools. USD per million tokens: input / output; lowest rate first in each group."
            >
              {(choice) => (
                <Select
                  name="modelId"
                  value={
                    choice.state.value ||
                    (available.find((item) => item.tools)?.id ?? "")
                  }
                  onChange={(event) => {
                    choice.handleChange(event.target.value);
                  }}
                >
                  {available.length === 0 ? (
                    <option value="">No supported models available</option>
                  ) : null}
                  {available.length > 0 &&
                  !available.some((item) => item.tools) ? (
                    <option value="">Choose a model</option>
                  ) : null}
                  {[true, false].map((tools) => {
                    const group = available.filter(
                      (item) => item.tools === tools,
                    );
                    return group.length === 0 ? null : (
                      <optgroup
                        key={String(tools)}
                        label={
                          tools ? "Tools" : "Other models (may not use tools)"
                        }
                      >
                        {group.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {tools ? "tools" : "chat only"} · $
                            {item.input} / ${item.output}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </Select>
              )}
            </FormField>
          );
        }}
      </model.form.Subscribe>
    </SchemaForm>
  );
}

function Secrets({
  port,
  view,
  notice,
  refresh,
}: {
  port: VaultPort;
  view: VaultView;
  notice: Notice;
  refresh: () => Promise<void>;
}) {
  const secrets = view.credentials.filter((item) => item.kind === "secret");
  const [formKey, setFormKey] = useState(0);
  return (
    <section className="tourtois-settings-stack" aria-label="Secrets">
      <SectionHead
        title="Secrets"
        note="An API key or token bound to the exact sites that may receive it. It is added to a request on the way out, only for the Agents and Computers you choose."
      />
      <DataList density="compact" aria-label="Secrets">
        {secrets.length === 0 ? (
          <DataRow className="tourtois-settings-empty">No secrets yet.</DataRow>
        ) : null}
        {secrets.map((credential) => (
          <CredentialRow
            key={credential.connectionId}
            port={port}
            view={view}
            credential={credential}
            notice={notice}
            refresh={refresh}
          />
        ))}
      </DataList>
      {view.role.manageTeam ? (
        <AddDisclosure
          key={formKey}
          label="Add secret"
          empty={secrets.length === 0}
        >
          {(close) => (
            <AddSecret
              notice={notice}
              onCancel={close}
              onAdd={async (draft) => {
                await port.addSecret(draft);
                await refresh();
                notice.done(
                  `${draft.label ?? draft.name} was stored. Choose who may use it.`,
                );
                setFormKey((current) => current + 1);
              }}
            />
          )}
        </AddDisclosure>
      ) : (
        <p className="tourtois-settings-note">
          Only Team owners and admins can add or change secrets.
        </p>
      )}
    </section>
  );
}

function ConnectionCredentials({
  port,
  view,
  notice,
  refresh,
}: {
  port: VaultPort;
  view: VaultView;
  notice: Notice;
  refresh: () => Promise<void>;
}) {
  const connections = view.credentials.filter((item) => item.kind !== "secret");
  return (
    <section
      className="tourtois-settings-stack"
      aria-label="Connection credentials"
    >
      <SectionHead
        title="Connection credentials"
        note="Values your Connections signed in with or were given. Rotate or revoke them here."
      />
      <DataList density="compact" aria-label="Connection credentials">
        {connections.length === 0 ? (
          <DataRow className="tourtois-settings-empty">
            No Connection holds a credential yet.
          </DataRow>
        ) : null}
        {connections.map((credential) => (
          <CredentialRow
            key={credential.connectionId}
            port={port}
            view={view}
            credential={credential}
            notice={notice}
            refresh={refresh}
          />
        ))}
      </DataList>
    </section>
  );
}

const credentialText = {
  value: "Pasted value",
  "sign-in": "Signed in",
  none: "No credential",
} as const;
const stateText = {
  active: "",
  pending: " · Waiting for sign-in",
  reconnect_required: " · Sign in again",
} as const;

function CredentialRow({
  port,
  view,
  credential,
  notice,
  refresh,
}: {
  port: VaultPort;
  view: VaultView;
  credential: VaultCredential;
  notice: Notice;
  refresh: () => Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState(false);
  const secret = credential.kind === "secret";
  const manage = view.role.manageTeam;
  const name = credential.label;
  const toggle = (next: Panel) => {
    setPanel((current) => (current === next ? null : next));
  };
  const placement = placementText(credential.placement);
  return (
    <DataRow>
      <div className="tourtois-vault-item">
        <SettingsItem
          title={name}
          detail={
            <>
              {secret ? (
                <>
                  {(credential.destinations ?? []).map((destination) => (
                    <p
                      key={`${destination.host}${destination.pathPrefix ?? ""}`}
                      className="tourtois-vault-mono"
                    >
                      {destinationText(destination)}
                    </p>
                  ))}
                  <p>
                    {placement === null ? "" : `${placement} · `}
                    {subjectsText(credential.subjects, false)}
                  </p>
                </>
              ) : (
                <>
                  <p className="tourtois-vault-mono">{credential.origin}</p>
                  <p>
                    {credentialText[credential.credential]}
                    {stateText[credential.state]} ·{" "}
                    {subjectsText(credential.subjects, true)}
                  </p>
                </>
              )}
              {unprotected(view, "connection", credential.connectionId) ? (
                <p>
                  <UnprotectedMark />
                </p>
              ) : null}
            </>
          }
          actions={
            <>
              {manage && credential.credential === "value" ? (
                <KeycapButton
                  density="compact"
                  label="Rotate"
                  aria-label={`Rotate ${name}`}
                  aria-expanded={panel === "rotate"}
                  disabled={busy}
                  onClick={() => {
                    toggle("rotate");
                  }}
                />
              ) : null}
              {secret ? (
                <KeycapButton
                  density="compact"
                  label="Scope"
                  aria-label={`Scope ${name}`}
                  aria-expanded={panel === "scope"}
                  disabled={busy}
                  onClick={() => {
                    toggle("scope");
                  }}
                />
              ) : null}
              <KeycapButton
                density="compact"
                label="Usage"
                aria-label={`Usage of ${name}`}
                aria-expanded={panel === "usage"}
                onClick={() => {
                  toggle("usage");
                }}
              />
              {manage && (secret || credential.credential !== "none") ? (
                <KeycapButton
                  density="compact"
                  tone="destructive"
                  label="Revoke"
                  aria-label={`Revoke ${name}`}
                  aria-expanded={panel === "revoke"}
                  disabled={busy}
                  onClick={() => {
                    toggle("revoke");
                  }}
                />
              ) : null}
            </>
          }
        />
        {panel === "rotate" ? (
          <RotatePanel
            name={name}
            hint={
              secret
                ? "Who may use it and where it is sent stay the same. The old value stops working here at once."
                : "The Connection and its Agents stay the same. The old value stops working here at once."
            }
            notice={notice}
            onCancel={() => {
              setPanel(null);
            }}
            onRotate={async (value) => {
              await port.updateCredential(credential.connectionId, {
                expectedVersion: credential.version,
                secret: value,
              });
              setPanel(null);
              notice.done(`${name} now uses the new value.`);
              await refresh();
            }}
          />
        ) : null}
        {panel === "scope" && secret ? (
          <ScopePanel
            port={port}
            view={view}
            credential={credential}
            manage={manage}
            notice={notice}
            refresh={refresh}
          />
        ) : null}
        {panel === "usage" ? (
          <UsagePanel
            name={name}
            queryKey={[...vaultQueryKey, "usage", credential.connectionId]}
            read={() => port.credentialUsage(credential.connectionId)}
            view={view}
          />
        ) : null}
        {panel === "revoke" ? (
          <RevokePanel
            name={name}
            action="Revoke"
            consequence={
              secret
                ? "It is deleted. The next request that needs it is refused, with no restart."
                : "The Connection stays, without its value, until you add a new one."
            }
            disabled={busy}
            onCancel={() => {
              setPanel(null);
            }}
            onConfirm={async () => {
              setBusy(true);
              try {
                await port.revokeCredential(
                  credential.connectionId,
                  credential.version,
                );
                setPanel(null);
                notice.done(`${name} was revoked.`);
                await refresh();
              } catch (cause) {
                console.error("Vault revoke failed", cause);
                notice.error(failure(cause, `${name} could not be revoked.`));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
      </div>
    </DataRow>
  );
}

/** An inline panel under one row: its own heading and quiet frame. */
function RowPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="tourtois-vault-panel" aria-label={label}>
      {children}
    </section>
  );
}

function RotatePanel({
  name,
  hint,
  notice,
  onCancel,
  onRotate,
}: {
  name: string;
  hint: string;
  notice: Notice;
  onCancel: () => void;
  onRotate: (value: string) => Promise<void>;
}) {
  const schema = useMemo(
    () =>
      z.object({
        value: z
          .string()
          .min(1, "Paste the new value")
          .max(16_384)
          .meta(
            field({
              label: "New value",
              help: hint,
              render: writeOnly,
            }),
          ),
      }),
    [hint],
  );
  const [pending, setPending] = useState(false);
  const model = useSchemaForm({
    schema,
    defaultValues: { value: "" },
    onSubmit: async ({ value }) => {
      setPending(true);
      try {
        await onRotate(value);
        return { kind: "saved", values: { value: "" } };
      } catch (cause) {
        notice.error(failure(cause, `${name} could not be replaced.`));
        return { kind: "refused" };
      } finally {
        setPending(false);
      }
    },
  });
  return (
    <RowPanel label={`Rotating ${name}`}>
      <SchemaForm
        model={model}
        aria-label={`New value for ${name}`}
        disabled={pending}
        footer={
          <FormFooter divider={false}>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Replacing…" : "Replace value"}
            </Button>
          </FormFooter>
        }
      />
    </RowPanel>
  );
}

function RevokePanel({
  name,
  action,
  consequence,
  disabled,
  onCancel,
  onConfirm,
}: {
  name: string;
  action: "Revoke" | "Remove";
  consequence: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <RowPanel
      label={`${action === "Revoke" ? "Revoking" : "Removing"} ${name}`}
    >
      <p className="tourtois-vault-panel-copy">
        <strong>
          {action} {name}?
        </strong>{" "}
        {consequence}
      </p>
      <FormFooter divider={false}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Keep it
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={disabled}
          onClick={() => void onConfirm()}
        >
          {disabled
            ? `${action === "Revoke" ? "Revoking" : "Removing"}…`
            : action}
        </Button>
      </FormFooter>
    </RowPanel>
  );
}

const outcomeText = {
  placed: "Sent",
  upstream_status: "Answered",
  refused_destination: "Refused: wrong site",
  refused_grant: "Refused: not allowed",
  failed: "No answer",
} as const;
const outcomeTone = {
  placed: "success",
  upstream_status: "success",
  refused_destination: "error",
  refused_grant: "error",
  failed: "warning",
} as const;

function UsagePanel({
  name,
  queryKey,
  read,
  view,
}: {
  name: string;
  queryKey: readonly unknown[];
  read: () => Promise<readonly VaultUse[]>;
  view: VaultView;
}) {
  const usage = useQuery({ queryKey, queryFn: read, retry: false });
  const subjectName = (subject: VaultSubject | null) => {
    if (subject === null) return "Unknown caller";
    const list =
      subject.kind === "agent"
        ? view.subjects.agents
        : subject.kind === "computer"
          ? view.subjects.computers
          : [];
    const listed = list.find((item) => item.id === subject.id)?.name;
    return (
      listed ??
      (subject.kind === "team-key"
        ? "A Team key"
        : subject.kind === "computer"
          ? "A Computer"
          : "An Agent")
    );
  };
  return (
    <RowPanel label={`History of ${name}`}>
      {usage.isPending ? (
        <p role="status" className="tourtois-settings-empty">
          Loading uses…
        </p>
      ) : null}
      {usage.isError ? (
        <div role="alert" className="tourtois-settings-notice">
          <Status glyph="dot" tone="error" size="compact" />
          <p>Uses could not be loaded.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void usage.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {usage.data?.length === 0 ? (
        <p className="tourtois-settings-empty">Not used yet.</p>
      ) : null}
      {usage.data !== undefined && usage.data.length > 0 ? (
        <ul className="tourtois-vault-usage" aria-label={`Uses of ${name}`}>
          {usage.data.map((use) => (
            <li
              key={`${String(use.lastAt)}:${use.subject?.kind ?? ""}:${use.subject?.id ?? ""}:${use.outcome}:${use.host ?? ""}:${use.method ?? ""}:${String(use.status)}`}
              className="tourtois-vault-use"
            >
              <Status
                glyph="dot"
                size="compact"
                tone={outcomeTone[use.outcome]}
                label={
                  outcomeText[use.outcome] +
                  (use.status === null ? "" : ` ${String(use.status)}`)
                }
              />
              <span className="tourtois-vault-use-who">
                {subjectName(use.subject)}
              </span>
              <span className="tourtois-vault-use-where tourtois-vault-mono">
                {[use.method, use.host].filter(Boolean).join(" ")}
              </span>
              <span className="tourtois-vault-use-when">
                {use.count > 1 ? `${String(use.count)}× · ` : ""}
                {timeText(use.lastAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="tourtois-vault-panel-copy">
        Each use is kept for 90 days: who, when, the site and the outcome. Never
        the value, the full path or the reply.
      </p>
    </RowPanel>
  );
}

function ScopePanel({
  port,
  view,
  credential,
  manage,
  notice,
  refresh,
}: {
  port: VaultPort;
  view: VaultView;
  credential: VaultCredential;
  manage: boolean;
  notice: Notice;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const granted = (kind: ScopeKind, id: string) =>
    credential.subjects.some(
      (subject) => subject.kind === kind && subject.id === id,
    );
  const change = async (kind: ScopeKind, id: string, on: boolean) => {
    const subject = { kind, id };
    setPending(`${kind}:${id}`);
    try {
      await (on
        ? port.grant(credential.connectionId, subject)
        : port.ungrant(credential.connectionId, subject));
      await refresh();
    } catch (cause) {
      console.error("Vault grant change failed", cause);
      notice.error(failure(cause, "Who may use it could not be changed."));
    } finally {
      setPending(null);
    }
  };
  const group = (
    kind: ScopeKind,
    legend: string,
    items: VaultView["subjects"]["agents"],
  ) => (
    <FieldSet legend={legend} disabled={!manage}>
      {items.length === 0 ? (
        <p className="tourtois-settings-empty">
          {kind === "agent" ? "No Agents yet." : "No Computers yet."}
        </p>
      ) : (
        <div className="tourtois-vault-choices">
          {items.map((item) => (
            <Choice
              key={item.id}
              label={item.name}
              checked={granted(kind, item.id)}
              disabled={!manage || pending !== null}
              onChange={(event) => {
                void change(kind, item.id, event.currentTarget.checked);
              }}
            />
          ))}
        </div>
      )}
    </FieldSet>
  );
  return (
    <RowPanel label={`Scope of ${credential.label}`}>
      <div className="tourtois-vault-scope">
        {group("agent", "Agents", view.subjects.agents)}
        {group("computer", "Computers", view.subjects.computers)}
        <p className="tourtois-vault-panel-copy">
          Anyone who can run commands on the Computer this Agent works on can
          use this secret while it works, only on the sites you allow.
        </p>
        <p className="tourtois-vault-panel-copy">
          A grant to an Agent never reaches the visitors its channels talk to.
        </p>
        <EditDestinations
          key={credential.version}
          initial={credential.destinations ?? []}
          disabled={!manage}
          onSave={async (destinations) => {
            try {
              await port.updateCredential(credential.connectionId, {
                expectedVersion: credential.version,
                destinations,
              });
              notice.done(`${credential.label} now goes only to these sites.`);
              await refresh();
            } catch (cause) {
              console.error("Vault sites change failed", cause);
              notice.error(failure(cause, "The sites could not be saved."));
            }
          }}
          notice={notice}
        />
      </div>
    </RowPanel>
  );
}

/** One site row being edited; `key` names the row, never the site. */
type DestinationDraft = {
  key: string;
  host: string;
  pathPrefix: string;
  methods: VaultMethod[];
};
let draftSerial = 0;
const draftKey = () => {
  draftSerial += 1;
  return `site-${String(draftSerial)}`;
};
const blankDestination = (): DestinationDraft => ({
  key: draftKey(),
  host: "",
  pathPrefix: "",
  methods: ["GET", "POST"],
});
const draftOf = (destination: VaultDestination): DestinationDraft => ({
  key: draftKey(),
  host: destination.host,
  pathPrefix: destination.pathPrefix ?? "",
  methods: [...destination.methods],
});

type SitesResult =
  | { kind: "sites"; destinations: VaultDestination[] }
  | { kind: "refused"; reason: string };
const refused = (reason: string): SitesResult => ({ kind: "refused", reason });

/** Exact hosts only: the owner's sites, checked again by the server. */
function destinationsFrom(drafts: readonly DestinationDraft[]): SitesResult {
  if (drafts.length === 0) return refused("Bind it to at least one site.");
  const out: VaultDestination[] = [];
  for (const draft of drafts) {
    const host = draft.host.trim().toLowerCase();
    if (host.length === 0)
      return refused("Enter each site's host, like api.stripe.com.");
    if (host.includes("*") || host.includes("/") || host.includes(":"))
      return refused(
        "Enter an exact host, like api.stripe.com, with no wildcard, scheme or port.",
      );
    if (draft.methods.length === 0)
      return refused(`Choose at least one method for ${host}.`);
    const pathPrefix = draft.pathPrefix.trim();
    if (pathPrefix.length > 0 && !pathPrefix.startsWith("/"))
      return refused(`Start the path for ${host} with /.`);
    const destination: VaultDestination = { host, methods: draft.methods };
    if (pathPrefix.length > 0) destination.pathPrefix = pathPrefix;
    out.push(destination);
  }
  return { kind: "sites", destinations: out };
}

function DestinationsEditor({
  value,
  onChange,
  disabled,
}: {
  value: readonly DestinationDraft[];
  onChange: (next: DestinationDraft[]) => void;
  disabled: boolean;
}) {
  const update = (index: number, patch: Partial<DestinationDraft>) => {
    onChange(
      value.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)),
    );
  };
  return (
    <div className="tourtois-vault-destinations">
      {value.map((draft, index) => {
        const which = value.length > 1 ? ` ${String(index + 1)}` : "";
        return (
          <FieldSet
            key={draft.key}
            legend={`Site${which}`}
            disabled={disabled}
            className="tourtois-vault-destination"
          >
            <Field label="Host" description="Exact host, like api.stripe.com.">
              <Input
                value={draft.host}
                autoComplete="off"
                spellCheck={false}
                placeholder="api.example.com"
                onChange={(event) => {
                  update(index, { host: event.currentTarget.value });
                }}
              />
            </Field>
            <Field
              label="Path"
              optional
              description="Only paths that start with this."
            >
              <Input
                value={draft.pathPrefix}
                autoComplete="off"
                spellCheck={false}
                placeholder="/v1/"
                onChange={(event) => {
                  update(index, { pathPrefix: event.currentTarget.value });
                }}
              />
            </Field>
            <div
              role="group"
              aria-label={`Methods for site${which}`}
              className="tourtois-vault-choices tourtois-vault-methods"
            >
              {methods.map((method) => (
                <Choice
                  key={method}
                  label={method}
                  checked={draft.methods.includes(method)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    update(index, {
                      methods: methods.filter((item) =>
                        item === method ? on : draft.methods.includes(item),
                      ),
                    });
                  }}
                />
              ))}
            </div>
            {value.length > 1 ? (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onChange(value.filter((_, at) => at !== index));
                  }}
                >
                  Remove site{which}
                </Button>
              </div>
            ) : null}
          </FieldSet>
        );
      })}
      {value.length < destinationLimit ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              onChange([...value, blankDestination()]);
            }}
          >
            Add another site
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EditDestinations({
  initial,
  disabled,
  notice,
  onSave,
}: {
  initial: readonly VaultDestination[];
  disabled: boolean;
  notice: Notice;
  onSave: (destinations: VaultDestination[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<DestinationDraft[]>(() =>
    initial.length === 0 ? [blankDestination()] : initial.map(draftOf),
  );
  const [pending, setPending] = useState(false);
  return (
    <form
      className="tourtois-vault-sites"
      aria-label="Sites it may be sent to"
      onSubmit={(event) => {
        event.preventDefault();
        const sites = destinationsFrom(drafts);
        if (sites.kind === "refused") {
          notice.error(sites.reason);
          return;
        }
        setPending(true);
        void onSave(sites.destinations).finally(() => {
          setPending(false);
        });
      }}
    >
      <DestinationsEditor
        value={drafts}
        onChange={setDrafts}
        disabled={disabled || pending}
      />
      {disabled ? null : (
        <FormFooter divider={false}>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save sites"}
          </Button>
        </FormFooter>
      )}
    </form>
  );
}

const placementKinds = {
  bearer: "Authorization: Bearer",
  basic: "Basic sign-in (user:password)",
  header: "A named header",
  query: "A query parameter",
} as const;

function AddSecret({
  notice,
  onCancel,
  onAdd,
}: {
  notice: Notice;
  /** Absent while the form is the only way forward (an empty list). */
  onCancel: (() => void) | undefined;
  onAdd: (draft: VaultSecretDraft) => Promise<void>;
}) {
  const schema = useMemo(
    () =>
      z.object({
        label: z
          .string()
          .trim()
          .min(1, "Name this secret")
          .max(128)
          .meta(
            field({
              label: "Name",
              placeholder: "Stripe",
              maxLength: 128,
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
              label: "Reference",
              placeholder: "stripe",
              maxLength: 32,
              help: "How commands refer to it. Lowercase letters, digits and _.",
            }),
          ),
        placement: z.enum(["bearer", "basic", "header", "query"]).meta(
          field({
            label: "Sent as",
            kind: "select",
            options: placementKinds,
          }),
        ),
        field: z
          .string()
          .max(64)
          .meta(
            field({
              label: "Header or parameter",
              placeholder: "X-Api-Key",
              maxLength: 64,
            }),
          ),
        secret: z
          .string()
          .min(1, "Paste the value")
          .max(16_384)
          .meta(
            field({
              label: "Value",
              help: "Stored sealed and never shown again.",
              render: writeOnly,
            }),
          ),
      }),
    [],
  );
  const [drafts, setDrafts] = useState<DestinationDraft[]>(() => [
    blankDestination(),
  ]);
  const [pending, setPending] = useState(false);
  const blank = {
    label: "",
    name: "",
    placement: "bearer" as const,
    field: "",
    secret: "",
  };
  const model = useSchemaForm({
    schema,
    defaultValues: blank,
    onSubmit: async (value) => {
      const sites = destinationsFrom(drafts);
      if (sites.kind === "refused") {
        notice.error(sites.reason);
        return { kind: "refused" };
      }
      const destinations = sites.destinations;
      const named = value.placement === "header" || value.placement === "query";
      if (named && !/^[A-Za-z0-9_.-]{1,64}$/u.test(value.field))
        return {
          kind: "refused",
          fields: { field: "Name the header or parameter it goes in." },
        };
      const placement: VaultPlacement =
        value.placement === "header"
          ? { header: value.field }
          : value.placement === "query"
            ? { query: value.field }
            : value.placement;
      setPending(true);
      try {
        await onAdd({
          name: value.name,
          label: value.label,
          destinations,
          placement,
          secret: value.secret,
        });
        return { kind: "saved", values: blank };
      } catch (cause) {
        notice.error(failure(cause, "The secret could not be stored."));
        return { kind: "refused" };
      } finally {
        setPending(false);
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Add secret"
      disabled={pending}
      footer={
        <FormFooter divider={false}>
          {onCancel === undefined ? null : (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Storing…" : "Add secret"}
          </Button>
        </FormFooter>
      }
    >
      <FormFields model={model} names={["label", "name"]} layout="columns" />
      <DestinationsEditor
        value={drafts}
        onChange={setDrafts}
        disabled={pending}
      />
      <model.form.Subscribe selector={(state) => state.values.placement}>
        {(placement) => (
          <FormFields
            model={model}
            names={[
              "placement",
              ...(placement === "header" || placement === "query"
                ? (["field"] as const)
                : []),
              "secret",
            ]}
            layout="columns"
          />
        )}
      </model.form.Subscribe>
    </SchemaForm>
  );
}
