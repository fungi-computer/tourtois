import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataListHeading,
  DataRow,
  FactRow,
} from "@fungi.computer/caps/components/data-list";
import { Select } from "@fungi.computer/caps/components/select";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import {
  FormField,
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

/** A provider the host offers; the host owns the list and the client only shows it. */
const providerChoiceSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  accountId: z.boolean(),
});
export type Provider = string;
const providerSchema = z.string().min(1);

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
  models: z.enum(["ready", "missing", "unknown"]),
  providers: z.array(providerChoiceSchema).min(1),
  catalogs: z.partialRecord(
    providerSchema,
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

/** Provider label from the host's list; an unlisted provider shows its id. */
const providerLabel = (
  providers: ModelKeysView["providers"],
  id: Provider,
): string => providers.find((choice) => choice.id === id)?.label ?? id;

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
                  detail={
                    <p>{providerLabel(view.data.providers, key.provider)}</p>
                  }
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
            providers={view.data.providers}
            onAdd={async (draft) => {
              await port.addKey(draft);
              await refresh();
              setFormKey((current) => current + 1);
            }}
          />
          <SectionHeading>Agent models</SectionHeading>
          {view.data.models === "missing" ? (
            <p role="status" className="tourtois-settings-note">
              No model is connected yet. The instance default cannot reply until
              you add a model key.
            </p>
          ) : null}
          <DataList density="compact" aria-label="Agent models">
            <DataListHeading>Current choice</DataListHeading>
            {agents.length === 0 ? (
              <DataRow className="tourtois-settings-empty">
                Create an Agent first.
              </DataRow>
            ) : null}
            {agents.map((agent) => {
              const selectedKey = keys.find(
                (key) => key.keyId === agent.choice?.keyId,
              );
              const catalog = Object.entries(view.data.catalogs).find(
                ([provider]) => provider === agent.choice?.model.providerId,
              )?.[1];
              const name = catalog?.find(
                (model) => model.id === agent.choice?.model.modelId,
              )?.name;
              const disconnected =
                view.data.models === "missing" ||
                (agent.choice?.keySource === "byok" &&
                  selectedKey === undefined);
              return (
                <FactRow
                  key={agent.agentId}
                  icon={<Sigil name="agent" />}
                  label={agent.name}
                >
                  {disconnected
                    ? "Not connected"
                    : agent.choice === null
                      ? "Unavailable"
                      : (name ??
                        (catalog === undefined
                          ? "Instance default"
                          : "Model unavailable for tools"))}
                  {disconnected || selectedKey === undefined
                    ? ""
                    : ` · ${selectedKey.label}`}
                </FactRow>
              );
            })}
          </DataList>
          {agents.length > 0 ? (
            <ChooseAgentModel
              key={keys.map((key) => key.keyId).join(":")}
              agents={agents}
              keys={keys}
              providers={view.data.providers}
              catalogs={view.data.catalogs}
              models={view.data.models}
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
  providers,
  onAdd,
}: {
  providers: ModelKeysView["providers"];
  onAdd: (draft: ModelKeyDraft) => Promise<void>;
}) {
  const needsAccountId = (provider: Provider) =>
    providers.find((choice) => choice.id === provider)?.accountId === true;
  const schema = useMemo(
    () =>
      z.object({
        provider: providerSchema.meta(
          field({
            label: "Provider",
            icon: <Sigil name="internet" />,
            kind: "select",
            options: Object.fromEntries(
              providers.map((choice) => [choice.id, choice.label]),
            ),
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
    [providers],
  );
  const add = useMutation({ mutationFn: onAdd });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      provider: providers[0]?.id ?? "",
      label: "",
      apiKey: "",
      accountId: "",
    },
    onSubmit: async (value) => {
      try {
        if (
          needsAccountId(value.provider) &&
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
          needsAccountId(value.provider)
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
              needsAccountId(provider)
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
  providers,
  catalogs,
  models,
  onChoose,
}: {
  agents: ModelKeysView["agents"];
  keys: ModelKeysView["keys"];
  providers: ModelKeysView["providers"];
  catalogs: ModelKeysView["catalogs"];
  models: ModelKeysView["models"];
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
        source: z.string(),
        modelId: z.string(),
      }),
    [agents],
  );
  const choose = useMutation({
    mutationFn: (input: { agentId: string; draft: AgentModelChoiceDraft }) =>
      onChoose(input.agentId, input.draft),
  });
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
        return { kind: "refused", error: "Choose a stored key." };
      const available = key === undefined ? [] : (catalogs[key.provider] ?? []);
      const modelId = value.modelId || available.find((item) => item.tools)?.id;
      if (key !== undefined && !available.some((item) => item.id === modelId))
        return {
          kind: "refused",
          error: "Choose a supported model for this key.",
        };
      try {
        await choose.mutateAsync({
          agentId: value.agentId,
          draft:
            key === undefined
              ? { keyId: null }
              : {
                  keyId: key.keyId,
                  provider: key.provider,
                  modelId: modelId ?? "",
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
