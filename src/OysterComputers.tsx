import { AppError } from "@fungi.computer/agar";
import { optimisticMutation } from "@fungi.computer/agar/query";
import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Field, FormFooter } from "@fungi.computer/caps/components/field";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Status } from "@fungi.computer/caps/components/status";
import { Switch } from "@fungi.computer/caps/components/switch";
import {
  SchemaForm,
  field,
  useSchemaForm,
  type SubmitResult,
} from "@fungi.computer/caps/form";
import { Sigil } from "@fungi.computer/sigils";
import { SettingsItem } from "./settings-item.js";
import {
  teamComputerDirectorySchema,
  teamComputerSchema,
  type TeamComputer,
} from "@fungi.computer/nacre/workbench";
import { workbenchDirectorySchema } from "@fungi.computer/nacre/workbench-directory";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import * as z from "zod";
import { requestIds } from "./team-directory.js";
import { tourtoisQueryKeys } from "./queries.js";

/** One owner-fleet page returned by the public Computer controls port. */
export type ComputerPage = z.output<typeof teamComputerDirectorySchema>;

/** Host-supplied owner controls over the existing fleet, not a second inventory. */
export type OysterComputersPort = Readonly<{
  list(offset: number): Promise<ComputerPage>;
  create(name: string | undefined, requestId: string): Promise<TeamComputer>;
  start(computerId: string): Promise<void>;
  internetAccess(computerId: string): Promise<boolean>;
  setInternetAccess(computerId: string, enabled: boolean): Promise<boolean>;
  keepAwake(computerId: string): Promise<boolean>;
  setKeepAwake(computerId: string, enabled: boolean): Promise<boolean>;
  /** Hosts that bill a running Computer's idle time say so beside Keep awake. */
  idleMetered?: true;
  /** Only hosts with a persisted default for new Apps supply selection. */
  selection?: Readonly<{
    selected(): Promise<string | null>;
    select(computerId: string): Promise<TeamComputer>;
  }>;
  /** Operator policy readback, when the host exposes it. Unknown locks writes. */
  egressPolicy?(): Promise<"enabled" | "globally-disabled" | "team-disabled">;
}>;

/** The durable per-Computer switches an owner manages. */
export type ComputerSwitchSetting = "internet-access" | "keep-awake";
const computerSwitchSchema = z.strictObject({ enabled: z.boolean() });

async function request(url: URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new AppError(
      `Computer request refused (${String(response.status)}).`,
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

/** Bind owner-admitted fleet controls to this trusted shell's host origin. */
export function createOysterComputersPort(origin: URL): OysterComputersPort {
  const read = (path: string, init?: RequestInit) =>
    request(new URL(path, origin), init);
  const switchPath = (computerId: string, setting: ComputerSwitchSetting) =>
    `/api/computers/${encodeURIComponent(computerId)}/${setting}`;
  const readSwitch = async (
    computerId: string,
    setting: ComputerSwitchSetting,
  ) => {
    const response = await read(switchPath(computerId, setting));
    return computerSwitchSchema.parse(await response.json()).enabled;
  };
  const writeSwitch = async (
    computerId: string,
    setting: ComputerSwitchSetting,
    enabled: boolean,
  ) => {
    const response = await read(switchPath(computerId, setting), {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    return computerSwitchSchema.parse(await response.json()).enabled;
  };
  return {
    list: async (offset) => {
      const response = await read(
        `/api/computers?${new URLSearchParams({ limit: "100", offset: String(offset) })}`,
      );
      return teamComputerDirectorySchema.parse(await response.json());
    },
    create: async (name, requestId) => {
      const response = await read("/api/computers", {
        method: "POST",
        body: JSON.stringify(
          name === undefined ? { requestId } : { requestId, name },
        ),
      });
      return teamComputerSchema.parse(await response.json());
    },
    start: async (computerId) => {
      // Success acknowledges this start, not a durable or polled health state.
      const response = await read(
        `/api/computers/${encodeURIComponent(computerId)}/start`,
        {
          method: "POST",
        },
      );
      await response.json();
    },
    selection: {
      selected: async () => {
        const response = await read("/api/workbench/directory");
        return (
          workbenchDirectorySchema.parse(await response.json()).computer
            ?.computerId ?? null
        );
      },
      select: async (computerId) => {
        const response = await read("/api/computers/selected", {
          method: "PUT",
          body: JSON.stringify({ computerId }),
        });
        return teamComputerSchema.parse(await response.json());
      },
    },
    internetAccess: (computerId) => readSwitch(computerId, "internet-access"),
    setInternetAccess: (computerId, enabled) =>
      writeSwitch(computerId, "internet-access", enabled),
    keepAwake: (computerId) => readSwitch(computerId, "keep-awake"),
    setKeepAwake: (computerId, enabled) =>
      writeSwitch(computerId, "keep-awake", enabled),
  };
}

const computerSettings = {
  "internet-access": { label: "Internet access", sigil: "internet" },
  "keep-awake": { label: "Keep awake", sigil: "schedule" },
} as const;

/**
 * One per-Computer setting row, the same wherever a Computer's switches show:
 * a Sigil and label, help under it, and the control opposite.
 */
export function ComputerSettingRow({
  setting,
  description,
  error,
  children,
}: {
  setting: ComputerSwitchSetting;
  description?: ReactNode;
  error?: ReactNode;
  /** The setting's Switch, or a retry key while it cannot be read. */
  children: ReactElement;
}) {
  const { label, sigil } = computerSettings[setting];
  return (
    <DataRow>
      <Field
        orientation="horizontal"
        icon={<Sigil name={sigil} />}
        label={label}
        description={description}
        error={error}
      >
        {children}
      </Field>
    </DataRow>
  );
}

/** One durable per-Computer switch: same read, save, retry and error shape. */
function ComputerSwitch({
  setting,
  description,
  computer,
  queryKey,
  read,
  write,
  locked,
}: {
  setting: ComputerSwitchSetting;
  description?: string | undefined;
  computer: TeamComputer;
  queryKey: readonly unknown[];
  read: () => Promise<boolean>;
  write: (enabled: boolean) => Promise<boolean>;
  locked: boolean;
}) {
  const { label } = computerSettings[setting];
  const current = useQuery({ queryKey, queryFn: read });
  const update = useMutation(
    optimisticMutation({
      queryKey,
      apply: (_previous: boolean, enabled: boolean) => enabled,
      mutationFn: write,
    }),
  );
  return (
    <ComputerSettingRow
      setting={setting}
      description={description}
      error={
        current.isError
          ? `Could not check ${label} for ${computer.name}.`
          : update.isError
            ? `Could not save ${label} for ${computer.name}.`
            : undefined
      }
    >
      {current.isError ? (
        <Button
          size="sm"
          variant="outline"
          aria-label={`Retry ${label}`}
          onClick={() => {
            void current.refetch();
          }}
        >
          Retry
        </Button>
      ) : (
        <Switch
          aria-label={`${label} for ${computer.name}`}
          checked={current.data ?? false}
          disabled={locked || current.data === undefined || update.isPending}
          onCheckedChange={(enabled) => {
            update.mutate(enabled);
          }}
        />
      )}
    </ComputerSettingRow>
  );
}

const lockedReason = {
  enabled: undefined,
  "globally-disabled": "Internet access is locked by the global off switch.",
  "team-disabled": "Internet access is locked for this Team.",
  unavailable: undefined,
} as const;

function InternetAccess({
  teamId,
  computer,
  port,
  policy,
}: {
  teamId: string;
  computer: TeamComputer;
  port: OysterComputersPort;
  policy: "enabled" | "globally-disabled" | "team-disabled" | "unavailable";
}) {
  return (
    <ComputerSwitch
      setting="internet-access"
      description={lockedReason[policy]}
      computer={computer}
      queryKey={tourtoisQueryKeys.oysterInternetAccess(
        teamId,
        computer.computerId,
      )}
      read={() => port.internetAccess(computer.computerId)}
      write={(enabled) => port.setInternetAccess(computer.computerId, enabled)}
      locked={policy !== "enabled"}
    />
  );
}

function KeepAwake({
  teamId,
  computer,
  port,
}: {
  teamId: string;
  computer: TeamComputer;
  port: OysterComputersPort;
}) {
  return (
    <ComputerSwitch
      setting="keep-awake"
      computer={computer}
      queryKey={tourtoisQueryKeys.oysterKeepAwake(teamId, computer.computerId)}
      read={() => port.keepAwake(computer.computerId)}
      write={(enabled) => port.setKeepAwake(computer.computerId, enabled)}
      locked={false}
      description={keepAwakeHelp(port.idleMetered === true)}
    />
  );
}

/** Keep awake's help; hosts that bill idle time say so. */
export const keepAwakeHelp = (idleMetered: boolean) =>
  `${
    idleMetered
      ? "Stays on when idle, and idle time is charged."
      : "Stays on when idle."
  } Off, it sleeps after 15 idle minutes.`;

const createComputerSchema = z.object({
  name: z
    .string()
    .trim()
    .max(256, "Use at most 256 characters.")
    .meta(
      field({
        label: "Name",
        icon: <Sigil name="computer" />,
        placeholder: "Leave blank for a generated name",
        maxLength: 256,
      }),
    ),
});

type Action =
  | Readonly<{
      kind: "create";
      name: string | undefined;
      requestId: string;
    }>
  | Readonly<{ kind: "start" | "select"; computerId: string }>;

/** Owner Settings over the host's existing inventory and optional default. */
export function OysterComputers({
  teamId,
  port,
  onChanged,
}: {
  teamId: string;
  port: OysterComputersPort;
  onChanged: () => void;
}) {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const intent = useRef<Extract<Action, { kind: "create" }> | null>(null);
  const inventoryKey = tourtoisQueryKeys.oysterComputers(teamId);
  const selectionKey = tourtoisQueryKeys.oysterSelectedComputer(teamId);
  const selection = port.selection;
  const inventory = useQuery({
    queryKey: tourtoisQueryKeys.oysterComputerPage(teamId, offset),
    queryFn: () => port.list(offset),
  });
  const selected = useQuery({
    queryKey: selectionKey,
    enabled: selection !== undefined,
    queryFn: () =>
      selection === undefined
        ? Promise.reject(new Error("This host has no default Computer"))
        : selection.selected(),
  });
  const policy = useQuery({
    queryKey: tourtoisQueryKeys.oysterEgressPolicy(teamId),
    enabled: port.egressPolicy !== undefined,
    queryFn: () =>
      port.egressPolicy === undefined
        ? Promise.reject(new Error("This host has no egress policy readback"))
        : port.egressPolicy(),
  });
  const action = useMutation({
    mutationFn: async (input: Action) => {
      switch (input.kind) {
        case "create":
          await port.create(input.name, input.requestId);
          return;
        case "start":
          await port.start(input.computerId);
          return;
        case "select":
          if (selection === undefined)
            throw new Error("This host has no default Computer");
          await selection.select(input.computerId);
      }
    },
    onSuccess: async (_result, input) => {
      if (input.kind === "create") {
        intent.current = null;
        setOffset(0);
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: inventoryKey }),
        ...(selection === undefined
          ? []
          : [client.invalidateQueries({ queryKey: selectionKey })]),
      ]);
      onChanged();
    },
  });
  const unavailable =
    inventory.isError ||
    (selection !== undefined && selected.isError) ||
    inventory.isFetching ||
    (selection !== undefined && selected.isFetching) ||
    action.isPending;
  const create = useSchemaForm({
    schema: createComputerSchema,
    defaultValues: { name: "" },
    failure: "Could not create the Computer.",
    onSubmit: async ({ name }): Promise<SubmitResult<{ name: string }>> => {
      const requestedName = name === "" ? undefined : name;
      // A retried create keeps its request identity until the host confirms it.
      if (intent.current === null || intent.current.name !== requestedName)
        intent.current = {
          kind: "create",
          name: requestedName,
          requestId: requestIds.request.generate(),
        };
      try {
        await action.mutateAsync(intent.current);
      } catch (cause) {
        return cause instanceof Error
          ? { kind: "refused", error: cause.message }
          : { kind: "refused" };
      }
      return { kind: "saved", values: { name: "" } };
    },
  });
  const policyStatus =
    port.egressPolicy === undefined
      ? "enabled"
      : (policy.data ?? "unavailable");

  const computers = inventory.data?.computers ?? [];
  const paged = offset > 0 || inventory.data?.nextOffset != null;
  return (
    <section className="tourtois-settings-stack" aria-label="Computers">
      <SectionHeading>Computers</SectionHeading>
      <p className="tourtois-settings-lede">
        {selection === undefined
          ? "Manage your Team's Computers."
          : "Choose the default Computer used for new App configurations."}
      </p>
      {port.egressPolicy !== undefined && policyStatus === "unavailable" ? (
        <div role="alert" className="tourtois-settings-notice">
          <p>Internet access policy is unavailable; switches are locked.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void policy.refetch()}
          >
            Retry policy
          </Button>
        </div>
      ) : null}
      {inventory.isPending ? <p role="status">Loading Computers…</p> : null}
      {inventory.isError || (selection !== undefined && selected.isError) ? (
        <div role="alert" className="tourtois-settings-notice">
          <p>Computer inventory or selection could not be loaded.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void inventory.refetch();
              if (selection !== undefined) void selected.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {inventory.isSuccess && computers.length === 0 ? (
        <p>No Computers on this page.</p>
      ) : null}
      {computers.map((computer) => {
        const isDefault =
          selection !== undefined &&
          selected.isSuccess &&
          selected.data === computer.computerId;
        return (
          <section
            key={computer.computerId}
            className="tourtois-computer"
            aria-label={computer.name}
          >
            <SettingsItem
              icon={<Sigil name="computer" />}
              title={computer.name}
              actions={
                <>
                  <KeycapButton
                    density="compact"
                    label="Start"
                    icon={<Sigil name="run" />}
                    aria-label={`Start ${computer.name}`}
                    disabled={unavailable}
                    onClick={() => {
                      action.mutate({
                        kind: "start",
                        computerId: computer.computerId,
                      });
                    }}
                  />
                  {isDefault ? (
                    <Status
                      size="compact"
                      tone="success"
                      label="Default for new Apps"
                    />
                  ) : selection !== undefined ? (
                    <KeycapButton
                      density="compact"
                      label="Use for new Apps"
                      icon={<Sigil name="allApps" />}
                      aria-label={`Use ${computer.name} for new Apps`}
                      disabled={unavailable}
                      onClick={() => {
                        action.mutate({
                          kind: "select",
                          computerId: computer.computerId,
                        });
                      }}
                    />
                  ) : null}
                </>
              }
            />
            <DataList
              density="compact"
              aria-label={`${computer.name} settings`}
            >
              <InternetAccess
                teamId={teamId}
                computer={computer}
                port={port}
                policy={policyStatus}
              />
              <KeepAwake teamId={teamId} computer={computer} port={port} />
            </DataList>
          </section>
        );
      })}
      {paged ? (
        <div className="tourtois-settings-notice" aria-label="Computer pages">
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable || offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 100));
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable || inventory.data?.nextOffset == null}
            onClick={() => {
              const next = inventory.data?.nextOffset;
              if (next != null) setOffset(next);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
      <SchemaForm
        model={create}
        layout="columns"
        aria-label="Create Computer"
        disabled={unavailable}
        footer={
          <FormFooter divider={false} error={create.error}>
            <Button type="submit" disabled={unavailable}>
              Create Computer
            </Button>
          </FormFooter>
        }
      />
      {action.isError && action.variables.kind !== "create" ? (
        <p role="alert">{action.error.message}</p>
      ) : null}
      {action.isSuccess ? (
        <p role="status">Computer request completed.</p>
      ) : null}
    </section>
  );
}
