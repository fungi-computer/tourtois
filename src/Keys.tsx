import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { Badge } from "@fungi.computer/caps/components/badge";
import { Button } from "@fungi.computer/caps/components/button";
import { Checkbox } from "@fungi.computer/caps/components/checkbox";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Field, FormFooter } from "@fungi.computer/caps/components/field";
import { Select } from "@fungi.computer/caps/components/select";
import {
  FormFields,
  SchemaForm,
  field,
  useSchemaForm,
  useSchemaFormStatus,
} from "@fungi.computer/caps/form";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as z from "zod";

/** One App's level a key may hold: read-only, or read and change. */
const keyAppAccessLevelSchema = z.enum(["read", "write"]);
export type KeyAppAccessLevel = z.output<typeof keyAppAccessLevelSchema>;

/** What a grant reaches: every installed App (including future installs), or named ones. */
export const keyGrantTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({
    kind: z.literal("selected"),
    installationIds: z.array(z.string().min(1)),
  }),
]);
export type KeyGrantTarget = z.output<typeof keyGrantTargetSchema>;
/** One App-scoped grant a key holds. */
export const keyGrantSchema = z.strictObject({
  level: keyAppAccessLevelSchema,
  target: keyGrantTargetSchema,
});
export type KeyGrant = z.output<typeof keyGrantSchema>;

/** One key as the host lists it; its secret never comes back after issuing. */
export const keyRecordSchema = z.strictObject({
  keyId: z.string().min(1),
  name: z.string().min(1),
  grants: z.array(keyGrantSchema),
  /** The computer.use grant: off unless the owner turns it on for this key. */
  computerAccess: z.boolean(),
  expiresAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative().nullable(),
  revokedAt: z.number().int().nonnegative().nullable(),
});
export type KeyRecord = z.output<typeof keyRecordSchema>;
/** Every key this owner has issued. */
export const keysViewSchema = z.strictObject({
  keys: z.array(keyRecordSchema),
});
export type KeysView = z.output<typeof keysViewSchema>;
/** What the owner submits to issue one key. */
export type KeyIssueDraft = Readonly<{
  name: string;
  grants: readonly KeyGrant[];
  computerAccess: boolean;
  expiresAt: number | null;
}>;
/** The plaintext secret, shown exactly once, plus the issued record. */
export const keyIssueResultSchema = z.strictObject({
  plaintext: z.string().min(1),
  key: keyRecordSchema,
});
export type KeyIssueResult = z.output<typeof keyIssueResultSchema>;
/** The host's owner-direct custody for Keys. */
export type KeysPort = Readonly<{
  list(): Promise<KeysView>;
  issue(draft: KeyIssueDraft): Promise<KeyIssueResult>;
  revoke(keyId: string, requestId: string): Promise<KeyRecord>;
}>;
/** One App this Oyster has installed, as the Keys page needs it. */
export type KeyAppOption = Readonly<{
  installationId: string;
  displayName: string;
}>;

const revokeIds = defineIdFamily({
  family: "tourtois-keys-revoke-request",
  version: 1,
  kinds: { request: { prefix: "request" } },
});

const queryKey = ["tourtois", "keys"] as const;

const accessLevelLabel = {
  read: "Read",
  write: "Read and change",
} satisfies Readonly<Record<KeyAppAccessLevel, string>>;

function grantSummary(
  grants: readonly KeyGrant[],
  apps: readonly KeyAppOption[],
): string {
  const all = grants.find((grant) => grant.target.kind === "all");
  if (all)
    return `All Apps, including future installs (${accessLevelLabel[all.level]})`;
  if (grants.length === 0) return "No App access";
  const names = new Map(
    apps.map((app) => [app.installationId, app.displayName]),
  );
  return grants
    .flatMap((grant) =>
      grant.target.kind === "selected"
        ? grant.target.installationIds.map(
            (id) => `${names.get(id) ?? id} (${accessLevelLabel[grant.level]})`,
          )
        : [],
    )
    .join(", ");
}

function expirySummary(key: Pick<KeyRecord, "expiresAt">): string {
  if (key.expiresAt === null) return "Never expires";
  const date = new Date(key.expiresAt).toLocaleDateString();
  return key.expiresAt <= Date.now() ? `Expired ${date}` : `Expires ${date}`;
}

function lastUsedSummary(key: Pick<KeyRecord, "lastUsedAt">): string {
  return key.lastUsedAt === null
    ? "Never used"
    : `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`;
}

/**
 * The Keys settings on a standalone host: issue, list and revoke keys that
 * act with the owner's own access, limited to the Apps, level and expiry
 * chosen here. A key never gets its own identity; it narrows the owner's.
 */
export function Keys({
  port,
  apps,
}: {
  port: KeysPort;
  apps: readonly KeyAppOption[];
}) {
  const client = useQueryClient();
  const view = useQuery({ queryKey, queryFn: () => port.list() });
  const refresh = () => client.invalidateQueries({ queryKey });
  const revoke = useMutation({
    mutationFn: (keyId: string) =>
      port.revoke(keyId, revokeIds.request.generate()),
    onSuccess: refresh,
  });
  const keys = view.data?.keys ?? [];
  const [formKey, setFormKey] = useState(0);
  const [issued, setIssued] = useState<KeyIssueResult | null>(null);
  return (
    <section
      className="tourtois-settings-content tourtois-keys"
      aria-label="Keys"
    >
      <SectionHeading>Keys</SectionHeading>
      <p className="tourtois-settings-lede">
        Anyone holding this key can read the Apps you pick. Where you choose
        &ldquo;Read and change,&rdquo; it can change data without asking you
        first. If it can change Workflows, it can also run Workflows with your
        access, but only on the Apps it can reach.
      </p>
      {view.isPending ? <p>Loading keys…</p> : null}
      {view.isError ? (
        <div role="status">
          <p>Keys could not be loaded.</p>
          <Button size="sm" onClick={() => void view.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {view.isSuccess && keys.length === 0 ? <p>No keys yet.</p> : null}
      {keys.length > 0 ? (
        <DataList aria-label="Keys">
          {keys.map((key) => {
            const revoked = key.revokedAt !== null;
            return (
              <DataRow key={key.keyId} className="p-0">
                <ActionRow
                  label={
                    <>
                      {key.name}{" "}
                      {revoked ? (
                        <Badge size="sm" variant="quiet">
                          Revoked
                        </Badge>
                      ) : null}
                      {key.computerAccess ? (
                        <Badge size="sm" variant="quiet">
                          Computer
                        </Badge>
                      ) : null}
                    </>
                  }
                  description={`${grantSummary(key.grants, apps)} · ${expirySummary(key)} · ${lastUsedSummary(key)}`}
                  trailing={
                    revoked ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Revoke ${key.name}`}
                        disabled={revoke.isPending}
                        onClick={() => {
                          revoke.mutate(key.keyId);
                        }}
                      >
                        Revoke
                      </Button>
                    )
                  }
                />
              </DataRow>
            );
          })}
        </DataList>
      ) : null}
      {revoke.isError ? (
        <p role="alert">The key could not be revoked.</p>
      ) : null}
      <SectionHeading>New key</SectionHeading>
      {issued === null ? (
        <IssueKey
          key={formKey}
          apps={apps}
          onIssue={async (draft) => {
            const result = await port.issue(draft);
            setIssued(result);
            await refresh();
          }}
        />
      ) : (
        <div className="grid gap-sm" role="status">
          <p>
            Copy this key now. It is shown once and cannot be retrieved later.
          </p>
          <code className="break-all">{issued.plaintext}</code>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIssued(null);
              setFormKey((current) => current + 1);
            }}
          >
            I copied the key
          </Button>
        </div>
      )}
    </section>
  );
}

const expiryChoiceSchema = z.enum(["never", "30", "90", "365"]);
const issueFormFields = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give this key a name.")
    .max(128)
    .meta(field({ label: "Name", required: true, maxLength: 128 })),
  expiry: expiryChoiceSchema.meta(
    field({
      label: "Expires after",
      options: {
        never: "Never",
        "30": "30 days",
        "90": "90 days",
        "365": "1 year",
      },
    }),
  ),
});
type IssueFormValues = z.input<typeof issueFormFields>;
const issueFormDefaults: IssueFormValues = { name: "", expiry: "never" };

const perAppChoiceSchema = z.enum(["none", "read", "write"]);
type PerAppChoice = z.output<typeof perAppChoiceSchema>;

function IssueKey({
  apps,
  onIssue,
}: {
  apps: readonly KeyAppOption[];
  onIssue: (draft: KeyIssueDraft) => Promise<void>;
}) {
  const [allApps, setAllApps] = useState(false);
  const [allAppsLevel, setAllAppsLevel] = useState<KeyAppAccessLevel>("read");
  const [perApp, setPerApp] = useState<Readonly<Record<string, PerAppChoice>>>(
    () => Object.fromEntries(apps.map((app) => [app.installationId, "none"])),
  );
  const [computerAccess, setComputerAccess] = useState(false);
  const selectedCount = Object.values(perApp).filter(
    (choice) => choice !== "none",
  ).length;
  const hasAccess = allApps || selectedCount > 0;
  const model = useSchemaForm({
    schema: issueFormFields,
    defaultValues: issueFormDefaults,
    onSubmit: async (value) => {
      if (!hasAccess)
        return {
          kind: "refused",
          error: "Choose at least one App before issuing a key.",
        };
      const grants: KeyGrant[] = allApps
        ? [{ level: allAppsLevel, target: { kind: "all" } }]
        : (["write", "read"] as const).flatMap((level) => {
            const installationIds = Object.entries(perApp)
              .filter(([, choice]) => choice === level)
              .map(([installationId]) => installationId);
            return installationIds.length === 0
              ? []
              : [
                  {
                    level,
                    target: { kind: "selected" as const, installationIds },
                  },
                ];
          });
      try {
        await onIssue({
          name: value.name,
          grants,
          computerAccess,
          expiresAt:
            value.expiry === "never"
              ? null
              : Date.now() + Number(value.expiry) * 24 * 60 * 60 * 1000,
        });
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
  const { submitting: issuing } = useSchemaFormStatus(model);
  return (
    <SchemaForm
      model={model}
      aria-label="Issue a key"
      disabled={issuing}
      footer={
        <FormFooter error={model.error}>
          <Button type="submit" disabled={!hasAccess || issuing}>
            {issuing ? "Issuing…" : "Issue key"}
          </Button>
        </FormFooter>
      }
    >
      <FormFields model={model} disabled={issuing} />
      <Field label="All Apps, including future installs" orientation="inline">
        <Checkbox
          name="allApps"
          checked={allApps}
          disabled={issuing}
          onChange={(event) => {
            setAllApps(event.currentTarget.checked);
          }}
        />
      </Field>
      {allApps ? (
        <Field label="Access level for all Apps" orientation="horizontal">
          <Select
            name="allAppsLevel"
            disabled={issuing}
            value={allAppsLevel}
            onChange={(event) => {
              setAllAppsLevel(
                keyAppAccessLevelSchema.parse(event.currentTarget.value),
              );
            }}
          >
            <option value="read">Read</option>
            <option value="write">Read and change</option>
          </Select>
        </Field>
      ) : apps.length === 0 ? (
        <p>No Apps installed yet.</p>
      ) : (
        apps.map((app) => (
          <Field
            key={app.installationId}
            label={app.displayName}
            orientation="horizontal"
          >
            <Select
              name={`app:${app.installationId}`}
              disabled={issuing}
              value={perApp[app.installationId] ?? "none"}
              onChange={(event) => {
                const choice = perAppChoiceSchema.parse(
                  event.currentTarget.value,
                );
                setPerApp((current) => ({
                  ...current,
                  [app.installationId]: choice,
                }));
              }}
            >
              <option value="none">No access</option>
              <option value="read">Read</option>
              <option value="write">Read and change</option>
            </Select>
          </Field>
        ))
      )}
      <Field
        label="Computer access"
        description="Off by default. On lets this key run commands on this Oyster’s Computer."
        orientation="inline"
      >
        <Checkbox
          name="computerAccess"
          checked={computerAccess}
          disabled={issuing}
          onChange={(event) => {
            setComputerAccess(event.currentTarget.checked);
          }}
        />
      </Field>
    </SchemaForm>
  );
}
