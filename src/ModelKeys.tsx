import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataListHeading,
  DataRow,
  FactRow,
} from "@fungi.computer/caps/components/data-list";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import {
  FormFields,
  SchemaForm,
  field,
  useSchemaForm,
} from "@fungi.computer/caps/form";
import { Sigil } from "@fungi.computer/sigils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import * as z from "zod";
import { SettingsItem } from "./settings-item.js";

const providers = {
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
} as const;
export type Provider = keyof typeof providers;
const providerSchema = z.enum([
  "cloudflare-workers-ai",
  "anthropic",
  "openai",
  "openrouter",
]);

/** One stored key as the host lists it; the secret never comes back. */
const modelKeySchema = z.strictObject({
  keyId: z.string().min(1),
  provider: providerSchema,
  label: z.string().min(1),
  createdAt: z.number(),
  validatedAt: z.number(),
});
const agentChoiceSchema = z.strictObject({
  keySource: z.enum(["workers-ai", "ai-gateway", "byok"]),
  keyId: z.string().min(1).optional(),
  model: z.strictObject({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    reasoning: z.string().optional(),
  }),
});
/** Every stored key and every Agent with its persisted model choice. */
export const modelKeysViewSchema = z.strictObject({
  keys: z.array(modelKeySchema),
  agents: z.array(
    z.strictObject({
      agentId: z.string().min(1),
      name: z.string(),
      choice: agentChoiceSchema.nullable(),
    }),
  ),
});
export type ModelKeysView = z.output<typeof modelKeysViewSchema>;
/** What the owner submits to store one key. */
export type ModelKeyDraft = Readonly<{
  provider: Provider;
  label: string;
  apiKey: string;
  accountId?: string;
}>;
/** The Agent's next model: the instance default, or a stored key's provider. */
export type AgentModelChoiceDraft =
  | Readonly<{ keyId: null }>
  | Readonly<{ keyId: string; provider: Provider; modelId: string }>;
/** The host's owner-direct model-key custody and per-Agent model choice. */
export type ModelKeysPort = Readonly<{
  read(): Promise<ModelKeysView>;
  addKey(draft: ModelKeyDraft): Promise<void>;
  removeKey(keyId: string): Promise<void>;
  chooseModel(agentId: string, draft: AgentModelChoiceDraft): Promise<void>;
}>;

const queryKey = ["tourtois", "model-keys"] as const;
const defaultSource = "default";

/**
 * Model keys on a standalone host: store a provider API key once, then pick
 * which model and key each Agent runs on. A key is never shown again.
 */
export function ModelKeys({
  port,
  focus = false,
}: {
  port: ModelKeysPort;
  focus?: boolean;
}) {
  const client = useQueryClient();
  const view = useQuery({ queryKey, queryFn: () => port.read() });
  const status = view.status;
  const focusSetup = useCallback(
    (section: HTMLElement | null) => {
      if (!focus || status === "pending") return;
      const target =
        section?.querySelector<HTMLSelectElement>("select") ??
        section?.querySelector<HTMLButtonElement>("button");
      target?.focus();
    },
    [focus, status],
  );
  const refresh = () => client.invalidateQueries({ queryKey });
  const remove = useMutation({
    mutationFn: (keyId: string) => port.removeKey(keyId),
    onSuccess: refresh,
  });
  const keys = view.data?.keys ?? [];
  const agents = view.data?.agents ?? [];
  // A fresh form after each stored key, so the key field empties.
  const [formKey, setFormKey] = useState(0);
  return (
    <section
      ref={focusSetup}
      className="tourtois-settings-stack tourtois-model-keys"
      aria-label="Model keys"
    >
      <SectionHeading>Model keys</SectionHeading>
      <p className="tourtois-settings-lede">
        Bring your own provider API key. It is checked with the provider, sealed
        on this instance and never shown again. Each Agent can run on any key.
      </p>
      {view.isPending ? <p>Loading model keys…</p> : null}
      {view.isError ? (
        <div role="status" className="tourtois-settings-notice">
          <p>Model keys could not be loaded.</p>
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
          <DataList aria-label="Model keys">
            {keys.length === 0 ? (
              <DataRow className="tourtois-settings-empty">
                No model keys yet.
              </DataRow>
            ) : null}
            {keys.map((key) => (
              <DataRow key={key.keyId}>
                <SettingsItem
                  icon={<Sigil name="restricted" />}
                  title={key.label}
                  detail={<p>{providers[key.provider]}</p>}
                  actions={
                    <KeycapButton
                      density="compact"
                      tone="destructive"
                      label="Remove"
                      aria-label={`Remove ${key.label}`}
                      disabled={remove.isPending}
                      onClick={() => {
                        remove.mutate(key.keyId);
                      }}
                    />
                  }
                />
              </DataRow>
            ))}
          </DataList>
          {remove.isError ? (
            <p role="alert">The model key could not be removed.</p>
          ) : null}
          <AddModelKey
            key={formKey}
            onAdd={async (draft) => {
              await port.addKey(draft);
              await refresh();
              setFormKey((current) => current + 1);
            }}
          />
          <SectionHeading>Agent models</SectionHeading>
          <DataList density="compact" aria-label="Agent models">
            <DataListHeading>Current choice</DataListHeading>
            {agents.length === 0 ? (
              <DataRow className="tourtois-settings-empty">
                Create an Agent first.
              </DataRow>
            ) : null}
            {agents.map((agent) => {
              const keyLabel =
                agent.choice?.keyId === undefined
                  ? null
                  : (keys.find((key) => key.keyId === agent.choice?.keyId)
                      ?.label ?? "Removed key");
              return (
                <FactRow
                  key={agent.agentId}
                  icon={<Sigil name="agent" />}
                  label={agent.name}
                >
                  {agent.choice?.model.modelId ?? "Unavailable"}
                  {keyLabel === null ? "" : ` · ${keyLabel}`}
                </FactRow>
              );
            })}
          </DataList>
          {agents.length > 0 ? (
            <ChooseAgentModel
              agents={agents}
              keys={keys}
              onChoose={async (agentId, draft) => {
                await port.chooseModel(agentId, draft);
                await refresh();
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function AddModelKey({
  onAdd,
}: {
  onAdd: (draft: ModelKeyDraft) => Promise<void>;
}) {
  const schema = useMemo(
    () =>
      z.object({
        provider: providerSchema.meta(
          field({
            label: "Provider",
            icon: <Sigil name="internet" />,
            kind: "select",
            options: providers,
          }),
        ),
        label: z
          .string()
          .min(1, "Name this key")
          .max(64)
          .meta(
            field({
              label: "Name",
              icon: <Sigil name="write" />,
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
              icon: <Sigil name="internet" />,
              help: "Find this in your Cloudflare dashboard. The token needs Workers AI access for this account.",
              maxLength: 32,
            }),
          ),
        apiKey: z
          .string()
          .min(1, "Paste the key")
          .max(16_384)
          .meta(
            field({
              label: "API key",
              icon: <Sigil name="restricted" />,
              help: "Sealed on this instance and never shown again.",
              kind: "secret",
            }),
          ),
      }),
    [],
  );
  const add = useMutation({ mutationFn: onAdd });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      provider: "cloudflare-workers-ai",
      label: "",
      apiKey: "",
      accountId: "",
    },
    onSubmit: async (value) => {
      try {
        if (
          value.provider === "cloudflare-workers-ai" &&
          !/^[a-f0-9]{32}$/u.test(value.accountId)
        )
          return {
            kind: "refused",
            fields: {
              accountId: "Enter your 32-character Cloudflare account ID.",
            },
          };
        const draft: ModelKeyDraft = {
          provider: value.provider,
          label: value.label,
          apiKey: value.apiKey,
        };
        await add.mutateAsync(
          value.provider === "cloudflare-workers-ai"
            ? { ...draft, accountId: value.accountId }
            : draft,
        );
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "The model key could not be stored.",
        };
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Add model key"
      disabled={add.isPending}
      footer={
        <FormFooter divider={false} error={model.error}>
          <Button type="submit">
            {add.isPending ? "Checking…" : "Add model key"}
          </Button>
        </FormFooter>
      }
    >
      <model.form.Subscribe selector={(state) => state.values.provider}>
        {(provider) => (
          <FormFields
            model={model}
            names={
              provider === "cloudflare-workers-ai"
                ? ["provider", "label", "accountId", "apiKey"]
                : ["provider", "label", "apiKey"]
            }
            layout="columns"
          />
        )}
      </model.form.Subscribe>
    </SchemaForm>
  );
}

function ChooseAgentModel({
  agents,
  keys,
  onChoose,
}: {
  agents: ModelKeysView["agents"];
  keys: ModelKeysView["keys"];
  onChoose: (agentId: string, draft: AgentModelChoiceDraft) => Promise<void>;
}) {
  const schema = useMemo(
    () =>
      z.object({
        agentId: z.string().meta(
          field({
            label: "Agent",
            icon: <Sigil name="agent" />,
            kind: "select",
            options: Object.fromEntries(
              agents.map((agent) => [agent.agentId, agent.name]),
            ),
          }),
        ),
        source: z.string().meta(
          field({
            label: "Runs on",
            icon: <Sigil name="restricted" />,
            kind: "select",
            options: {
              [defaultSource]: "Instance default model",
              ...Object.fromEntries(
                keys.map((key) => [
                  key.keyId,
                  `${key.label} (${providers[key.provider]})`,
                ]),
              ),
            },
          }),
        ),
        modelId: z
          .string()
          .max(256)
          .meta(
            field({
              label: "Model",
              icon: <Sigil name="write" />,
              help: "For a key: the provider's model id, such as gpt-6-luna.",
              maxLength: 256,
            }),
          ),
      }),
    [agents, keys],
  );
  const choose = useMutation({
    mutationFn: (input: { agentId: string; draft: AgentModelChoiceDraft }) =>
      onChoose(input.agentId, input.draft),
  });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      agentId: agents[0]?.agentId ?? "",
      source: defaultSource,
      modelId: "",
    },
    onSubmit: async (value) => {
      const key = keys.find((item) => item.keyId === value.source);
      if (value.source !== defaultSource && key === undefined)
        return { kind: "refused", error: "Choose a stored key." };
      if (key !== undefined && value.modelId.length === 0)
        return { kind: "refused", error: "Name the model this key runs." };
      try {
        await choose.mutateAsync({
          agentId: value.agentId,
          draft:
            key === undefined
              ? { keyId: null }
              : {
                  keyId: key.keyId,
                  provider: key.provider,
                  modelId: value.modelId,
                },
        });
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "The model could not be saved.",
        };
      }
    },
  });
  return (
    <SchemaForm
      model={model}
      layout="columns"
      aria-label="Choose Agent model"
      disabled={choose.isPending}
      footer={
        <FormFooter divider={false} error={model.error}>
          <Button type="submit">
            {choose.isPending ? "Saving…" : "Save model"}
          </Button>
        </FormFooter>
      }
    />
  );
}
