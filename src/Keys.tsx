import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import { Checkbox } from "@fungi.computer/caps/components/checkbox";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Field, FormFooter } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import {
  FormFields,
  SchemaForm,
  field,
  useSchemaForm,
  useSchemaFormStatus,
} from "@fungi.computer/caps/form";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import type { Grant } from "@fungi.computer/ear-tag/grants";
import type {
  IssueKeyInput,
  KeySummary,
  UpdateGrantsInput,
} from "@fungi.computer/ear-tag/keys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ComponentType, type ReactNode } from "react";
import * as z from "zod";

export type KeyAppOption = Readonly<{
  installationId: string;
  displayName: string;
}>;
export type KeyTargetOption = Readonly<{ id: string; name: string }>;
/** Presentation supplied by the host, not another capability catalog. */
export type KeyGrantOption = Readonly<{
  capability: string;
  label: string;
  /** Omit for capabilities which have no selected-target form. */
  targets?: readonly KeyTargetOption[];
}>;
export type KeyIssueDraft = Pick<
  IssueKeyInput<string>,
  "name" | "grants" | "expiresAt"
>;
export type KeysView = Readonly<{ keys: readonly KeySummary<string>[] }>;
export type KeyIssueResult = Readonly<{
  plaintext: string;
  key: KeySummary<string>;
}>;
export type KeyChange = Readonly<{
  key: KeySummary<string>;
  notice: string;
  /** Replay the same command, never generate another mutation identity. */
  retry: boolean;
}>;
export type KeyGrantPreviewProps = Readonly<{
  grants: readonly Grant[];
  onReady: (ready: boolean) => void;
}>;
/** Hosts decode their current transport with their own Ear Tag vocabulary. */
export type KeysPort = Readonly<{
  scope: string;
  expiry: "required" | "optional";
  options(
    apps: readonly KeyAppOption[],
    signal: AbortSignal,
  ): Promise<readonly KeyGrantOption[]>;
  list(): Promise<KeysView>;
  issue(draft: KeyIssueDraft): Promise<KeyIssueResult>;
  updateGrants?(input: UpdateGrantsInput<string>): Promise<KeyChange>;
  revoke(keyId: string, requestId: string): Promise<KeyChange>;
  Preview?: ComponentType<KeyGrantPreviewProps>;
}>;

const mutationIds = defineIdFamily({
  family: "tourtois-keys-mutation",
  version: 1,
  kinds: { request: { prefix: "request" } },
});
type Command =
  | Readonly<{ kind: "revoke"; keyId: string; requestId: string }>
  | Readonly<{ kind: "grants"; input: UpdateGrantsInput<string> }>;

const keyQueryKeys = {
  list: (scope: string) => ["tourtois", "keys", scope] as const,
  options: (scope: string, apps: readonly KeyAppOption[]) =>
    [...keyQueryKeys.list(scope), "options", apps] as const,
};

/** Scope changes remount the secret-once state as well as separating query caches. */
export function Keys(props: { port: KeysPort; apps: readonly KeyAppOption[] }) {
  return <KeysContent key={props.port.scope} {...props} />;
}

function KeysContent({
  port,
  apps,
}: {
  port: KeysPort;
  apps: readonly KeyAppOption[];
}) {
  const client = useQueryClient();
  const queryKey = keyQueryKeys.list(port.scope);
  const view = useQuery({ queryKey, queryFn: () => port.list(), retry: false });
  const options = useQuery({
    queryKey: keyQueryKeys.options(port.scope, apps),
    queryFn: ({ signal }) => port.options(apps, signal),
    retry: false,
  });
  const [issued, setIssued] = useState<KeyIssueResult | null>(null);
  const [editing, setEditing] = useState<KeySummary<string> | null>(null);
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey });
  const mutate = async (pending: Command) => {
    setCommand(pending);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const change =
        pending.kind === "revoke"
          ? await port.revoke(pending.keyId, pending.requestId)
          : await (() => {
              if (port.updateGrants === undefined)
                throw new Error("Grant editing is not offered by this host");
              return port.updateGrants(pending.input);
            })();
      setNotice(change.notice);
      setEditing(null);
      if (!change.retry) setCommand(null);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The key change could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const labels = new Map(
    options.data?.map((option) => [option.capability, option.label]),
  );
  return (
    <section
      className="tourtois-settings-content tourtois-keys"
      aria-label="Keys"
    >
      <SectionHeading>Keys</SectionHeading>
      <p className="tourtois-settings-lede">
        Anyone holding a key can act with your current access, limited to its
        grants and expiry, without asking again. Read grants cannot make
        changes. Grants which run Workflows can also run them with your access,
        within the key's targets.
      </p>
      {view.isPending ? <p>Loading keys…</p> : null}
      {view.isError ? (
        <p role="alert">
          Keys could not be loaded.{" "}
          <Button onClick={() => void view.refetch()}>Retry</Button>
        </p>
      ) : null}
      {options.isError ? (
        <p role="alert">
          Capability targets could not be loaded.{" "}
          <Button onClick={() => void options.refetch()}>Retry targets</Button>
        </p>
      ) : null}
      {view.isSuccess && view.data.keys.length === 0 ? (
        <p>No keys yet.</p>
      ) : null}
      <DataList aria-label="Keys">
        {(view.data?.keys ?? []).map((key) => (
          <DataRow
            key={key.keyId}
            style={{ gridTemplateColumns: "minmax(0, 1fr)" }}
          >
            <div className="grid min-w-0 gap-sm">
              <div className="grid min-w-0 gap-xs break-words">
                <strong>
                  {key.name}
                  {key.revokedAt !== null ? " · Revoked" : ""}
                </strong>
                <p>
                  {key.grants.length === 0
                    ? "Authority unavailable; revoke and issue a new key."
                    : key.grants
                        .map(
                          (grant) =>
                            `${labels.get(grant.capability) ?? grant.capability}: ${grant.targets.kind === "all" ? "all current and future targets" : grant.targets.ids.join(", ")}`,
                        )
                        .join(" · ")}
                </p>
                <p>
                  {key.expiresAt === null
                    ? "Never expires"
                    : `${key.expiresAt <= Date.now() ? "Expired" : "Expires"} ${new Date(key.expiresAt).toLocaleString()}`}{" "}
                  ·{" "}
                  {key.lastUsedAt === null
                    ? "Use not recorded"
                    : `Last used ${new Date(key.lastUsedAt).toLocaleString()}`}
                </p>
              </div>
              {key.revokedAt === null ? (
                <div className="flex flex-wrap gap-sm">
                  {port.updateGrants !== undefined && key.grants.length > 0 ? (
                    <Button
                      aria-label={`Edit ${key.name}`}
                      disabled={busy || command !== null}
                      onClick={() => {
                        setEditing(key);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    aria-label={`Revoke ${key.name}`}
                    disabled={busy || command !== null}
                    onClick={() =>
                      void mutate({
                        kind: "revoke",
                        keyId: key.keyId,
                        requestId: mutationIds.request.generate(),
                      })
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ) : null}
            </div>
          </DataRow>
        ))}
      </DataList>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {command !== null ? (
        <div className="flex gap-sm">
          <Button disabled={busy} onClick={() => void mutate(command)}>
            Retry key change
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setCommand(null);
              setEditing(null);
              void refresh();
            }}
          >
            Reload keys
          </Button>
        </div>
      ) : null}
      {editing !== null && options.data !== undefined ? (
        <EditKey
          key={editing.keyId + ":" + String(editing.grantVersion)}
          record={editing}
          port={port}
          options={options.data}
          disabled={busy || command !== null}
          onCancel={() => {
            setEditing(null);
          }}
          onSave={(grants) =>
            mutate({
              kind: "grants",
              input: {
                requestId: mutationIds.request.generate(),
                keyId: editing.keyId,
                expectedGrantVersion: editing.grantVersion,
                grants,
              },
            })
          }
        />
      ) : null}
      <SectionHeading>New key</SectionHeading>
      {issued === null ? (
        options.data === undefined ? (
          <p>Loading capability targets…</p>
        ) : (
          <IssueKey
            port={port}
            options={options.data}
            onIssue={async (draft) => {
              const result = await port.issue(draft);
              setIssued(result);
              await refresh();
            }}
          />
        )
      ) : (
        <div className="grid gap-sm" role="status">
          <p>
            Copy this key now. It is shown once and cannot be retrieved later.
          </p>
          <code className="break-all">{issued.plaintext}</code>
          <Button
            onClick={() => {
              setIssued(null);
            }}
          >
            I copied the key
          </Button>
        </div>
      )}
    </section>
  );
}

function GrantEditor({
  grants,
  onChange,
  options,
  disabled,
}: {
  grants: readonly Grant[];
  onChange: (grants: readonly Grant[]) => void;
  options: readonly KeyGrantOption[];
  disabled: boolean;
}) {
  return (
    <fieldset className="grid gap-sm" disabled={disabled}>
      <legend>Capability grants</legend>
      {options.map((option) => {
        const grant = grants.find(
          (current) => current.capability === option.capability,
        );
        const replace = (targets: Grant["targets"]) => {
          onChange(
            grants.map((current) =>
              current.capability === option.capability
                ? { ...current, targets }
                : current,
            ),
          );
        };
        return (
          <div key={option.capability} className="grid gap-xs">
            <Field label={option.label} orientation="inline">
              <Checkbox
                name={"cap:" + option.capability}
                checked={grant !== undefined}
                onChange={(event) => {
                  onChange(
                    event.currentTarget.checked
                      ? [
                          ...grants,
                          {
                            capability: option.capability,
                            targets: { kind: "all" },
                          },
                        ]
                      : grants.filter(
                          (current) => current.capability !== option.capability,
                        ),
                  );
                }}
              />
            </Field>
            {grant !== undefined && option.targets !== undefined ? (
              <div className="grid gap-xs pl-md">
                <Field
                  label="All current and future targets"
                  orientation="inline"
                >
                  <Checkbox
                    name={"all:" + option.capability}
                    checked={grant.targets.kind === "all"}
                    onChange={(event) => {
                      replace(
                        event.currentTarget.checked
                          ? { kind: "all" }
                          : { kind: "selected", ids: [] },
                      );
                    }}
                  />
                </Field>
                {grant.targets.kind === "selected" ? (
                  <>
                    {option.targets.length === 0 ? (
                      <p>No targets available.</p>
                    ) : null}
                    {option.targets.map((target) => (
                      <Field
                        key={target.id}
                        label={target.name}
                        orientation="inline"
                      >
                        <Checkbox
                          name={option.capability + ":" + target.id}
                          checked={
                            grant.targets.kind === "selected" &&
                            grant.targets.ids.includes(target.id)
                          }
                          onChange={(event) => {
                            const ids =
                              grant.targets.kind === "selected"
                                ? grant.targets.ids
                                : [];
                            replace({
                              kind: "selected",
                              ids: event.currentTarget.checked
                                ? [...ids, target.id]
                                : ids.filter((id) => id !== target.id),
                            });
                          }}
                        />
                      </Field>
                    ))}
                    {grant.targets.ids
                      .filter(
                        (id) =>
                          !option.targets?.some((target) => target.id === id),
                      )
                      .map((id) => (
                        <p key={id}>Unavailable target: {id}</p>
                      ))}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {grants
        .filter(
          (grant) =>
            !options.some((option) => option.capability === grant.capability),
        )
        .map((grant) => (
          <div key={grant.capability}>
            <p>{grant.capability} is no longer offered by this host.</p>
            <Button
              type="button"
              onClick={() => {
                onChange(grants.filter((current) => current !== grant));
              }}
            >
              Remove {grant.capability}
            </Button>
          </div>
        ))}
    </fieldset>
  );
}

function GrantDraft({
  port,
  options,
  initial,
  disabled = false,
  children,
}: {
  port: KeysPort;
  options: readonly KeyGrantOption[];
  initial: readonly Grant[];
  disabled?: boolean;
  children: (grants: readonly Grant[], ready: boolean) => ReactNode;
}) {
  const [grants, setGrants] = useState(initial);
  const [review, setReview] = useState<{
    grants: readonly Grant[];
    ready: boolean;
  } | null>(null);
  const Preview = port.Preview;
  const valid =
    grants.length > 0 &&
    grants.every((grant) =>
      options.some((option) => option.capability === grant.capability),
    ) &&
    !grants.some(
      (grant) =>
        grant.targets.kind === "selected" && grant.targets.ids.length === 0,
    );
  const ready =
    valid &&
    (Preview === undefined || (review?.grants === grants && review.ready));
  return (
    <>
      <GrantEditor
        grants={grants}
        onChange={setGrants}
        options={options}
        disabled={disabled}
      />
      {Preview ? (
        <Preview
          grants={grants}
          onReady={(ready) => {
            setReview((current) =>
              current?.grants === grants && current.ready === ready
                ? current
                : { grants, ready },
            );
          }}
        />
      ) : null}
      {children(grants, ready)}
    </>
  );
}

function IssueKey({
  port,
  options,
  onIssue,
}: {
  port: KeysPort;
  options: readonly KeyGrantOption[];
  onIssue: (draft: KeyIssueDraft) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <GrantDraft port={port} options={options} initial={[]} disabled={busy}>
      {(grants, ready) => (
        <IssueForm
          port={port}
          grants={grants}
          ready={ready}
          onIssue={async (draft) => {
            setBusy(true);
            try {
              await onIssue(draft);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </GrantDraft>
  );
}

function IssueForm({
  port,
  grants,
  ready,
  onIssue,
}: {
  port: KeysPort;
  grants: readonly Grant[];
  ready: boolean;
  onIssue: (draft: KeyIssueDraft) => Promise<void>;
}) {
  const [custom, setCustom] = useState("");
  const expiryValues: ["30", "90", "365", "custom", ..."never"[]] =
    port.expiry === "required"
      ? ["30", "90", "365", "custom"]
      : ["30", "90", "365", "custom", "never"];
  const expiry = z.enum(expiryValues);
  const finiteExpiryOptions = {
    "30": "30 days",
    "90": "90 days",
    "365": "1 year",
    custom: "Custom date",
  };
  const schema = z.object({
    name: z
      .string()
      .trim()
      .min(1, "Give this key a name.")
      .max(128)
      .meta(field({ label: "Name", required: true, maxLength: 128 })),
    expiry: expiry.meta(
      field({
        label: "Expires after",
        options:
          port.expiry === "optional"
            ? { ...finiteExpiryOptions, never: "Never" }
            : finiteExpiryOptions,
      }),
    ),
  });
  const model = useSchemaForm({
    schema,
    defaultValues: {
      name: "",
      expiry: port.expiry === "required" ? "30" : "never",
    },
    onSubmit: async (value) => {
      if (!ready)
        return {
          kind: "refused",
          error: "Choose grants and finish their review before issuing.",
        };
      const expiresAt =
        value.expiry === "never"
          ? undefined
          : value.expiry === "custom"
            ? new Date(custom).getTime()
            : Date.now() + Number(value.expiry) * 86_400_000;
      if (
        expiresAt !== undefined &&
        (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
      )
        return { kind: "refused", error: "Choose a finite future expiry." };
      try {
        const draft = { name: value.name, grants };
        await onIssue(
          expiresAt === undefined ? draft : { ...draft, expiresAt },
        );
        return { kind: "saved" };
      } catch (cause) {
        return {
          kind: "refused",
          error:
            cause instanceof Error
              ? cause.message
              : "The key could not be issued.",
        };
      }
    },
  });
  const { submitting } = useSchemaFormStatus(model);
  return (
    <SchemaForm
      model={model}
      aria-label="Issue a key"
      footer={
        <FormFooter error={model.error}>
          <Button type="submit" disabled={!ready || submitting}>
            Issue key
          </Button>
        </FormFooter>
      }
    >
      <FormFields model={model} />
      <Field label="Custom expiry">
        <Input
          type="datetime-local"
          name="customExpiry"
          value={custom}
          disabled={submitting}
          onChange={(event) => {
            setCustom(event.currentTarget.value);
          }}
        />
      </Field>
    </SchemaForm>
  );
}

function EditKey({
  record,
  port,
  options,
  disabled,
  onSave,
  onCancel,
}: {
  record: KeySummary<string>;
  port: KeysPort;
  options: readonly KeyGrantOption[];
  disabled: boolean;
  onSave: (grants: readonly Grant[]) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <section aria-label={"Edit " + record.name} className="grid gap-sm">
      <SectionHeading>Edit {record.name}</SectionHeading>
      <GrantDraft
        port={port}
        options={options}
        initial={record.grants}
        disabled={disabled}
      >
        {(grants, ready) => (
          <div className="flex gap-sm">
            <Button
              disabled={disabled || !ready}
              onClick={() => void onSave(grants)}
            >
              Save grants
            </Button>
            <Button disabled={disabled} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </GrantDraft>
    </section>
  );
}
