import { AppError } from "@fungi.computer/agar";
import { optimisticMutation } from "@fungi.computer/agar/query";
import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Input } from "@fungi.computer/caps/components/input";
import { Switch } from "@fungi.computer/caps/components/switch";
import {
  teamComputerDirectorySchema,
  teamComputerSchema,
  type TeamComputer,
} from "@fungi.computer/nacre/workbench";
import { workbenchDirectorySchema } from "@fungi.computer/nacre/workbench-directory";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as z from "zod";
import { requestIds } from "./team-directory.js";
import { tourtoisQueryKeys } from "./queries.js";

/** One owner-fleet page returned by the public Computer controls port. */
export type ComputerPage = z.output<typeof teamComputerDirectorySchema>;

/** Owner controls over the existing standalone fleet, not a second inventory. */
export type OysterComputersPort = Readonly<{
  list(offset: number): Promise<ComputerPage>;
  selected(): Promise<string | null>;
  create(name: string | undefined, requestId: string): Promise<TeamComputer>;
  start(computerId: string): Promise<void>;
  select(computerId: string): Promise<TeamComputer>;
  internetAccess(computerId: string): Promise<boolean>;
  setInternetAccess(computerId: string, enabled: boolean): Promise<boolean>;
}>;

const internetAccessSchema = z.strictObject({ enabled: z.boolean() });

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
  return {
    list: async (offset) => {
      const response = await read(
        `/api/computers?${new URLSearchParams({ limit: "100", offset: String(offset) })}`,
      );
      return teamComputerDirectorySchema.parse(await response.json());
    },
    selected: async () => {
      const response = await read("/api/workbench/directory");
      return (
        workbenchDirectorySchema.parse(await response.json()).computer
          ?.computerId ?? null
      );
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
    select: async (computerId) => {
      const response = await read("/api/computers/selected", {
        method: "PUT",
        body: JSON.stringify({ computerId }),
      });
      return teamComputerSchema.parse(await response.json());
    },
    internetAccess: async (computerId) => {
      const response = await read(
        `/api/computers/${encodeURIComponent(computerId)}/internet-access`,
      );
      return internetAccessSchema.parse(await response.json()).enabled;
    },
    setInternetAccess: async (computerId, enabled) => {
      const response = await read(
        `/api/computers/${encodeURIComponent(computerId)}/internet-access`,
        { method: "PUT", body: JSON.stringify({ enabled }) },
      );
      return internetAccessSchema.parse(await response.json()).enabled;
    },
  };
}

function InternetAccess({
  teamId,
  computer,
  port,
}: {
  teamId: string;
  computer: TeamComputer;
  port: OysterComputersPort;
}) {
  const queryKey = tourtoisQueryKeys.oysterInternetAccess(
    teamId,
    computer.computerId,
  );
  const current = useQuery({
    queryKey,
    queryFn: () => port.internetAccess(computer.computerId),
  });
  const update = useMutation(
    optimisticMutation({
      queryKey,
      apply: (_previous: boolean, enabled: boolean) => enabled,
      mutationFn: (enabled: boolean) =>
        port.setInternetAccess(computer.computerId, enabled),
    }),
  );
  return (
    <div className="grid gap-sm">
      <label className="flex gap-sm">
        Internet access
        <Switch
          aria-label={`Internet access for ${computer.name}`}
          checked={current.data ?? false}
          disabled={current.data === undefined || update.isPending}
          onCheckedChange={(enabled) => {
            update.mutate(enabled);
          }}
        />
      </label>
      {current.isPending ? (
        <p role="status">Checking Internet access…</p>
      ) : null}
      {current.isError ? (
        <div role="alert">
          <p>Could not check Internet access for {computer.name}.</p>
          <Button
            onClick={() => {
              void current.refetch();
            }}
          >
            Retry Internet access
          </Button>
        </div>
      ) : null}
      {update.isError ? (
        <p role="alert">Could not save Internet access for {computer.name}.</p>
      ) : null}
    </div>
  );
}

type Action =
  | Readonly<{
      kind: "create";
      name: string | undefined;
      requestId: string;
    }>
  | Readonly<{ kind: "start" | "select"; computerId: string }>;

/** Owner Settings over the host's existing inventory and default selection. */
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
  const [name, setName] = useState("");
  const intent = useRef<Extract<Action, { kind: "create" }> | null>(null);
  const inventoryKey = tourtoisQueryKeys.oysterComputers(teamId);
  const selectionKey = tourtoisQueryKeys.oysterSelectedComputer(teamId);
  const inventory = useQuery({
    queryKey: tourtoisQueryKeys.oysterComputerPage(teamId, offset),
    queryFn: () => port.list(offset),
  });
  const selected = useQuery({
    queryKey: selectionKey,
    queryFn: () => port.selected(),
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
          await port.select(input.computerId);
      }
    },
    onSuccess: async (_result, input) => {
      if (input.kind === "create") {
        intent.current = null;
        setName("");
        setOffset(0);
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: inventoryKey }),
        client.invalidateQueries({ queryKey: selectionKey }),
      ]);
      onChanged();
    },
  });
  const unavailable =
    inventory.isError ||
    selected.isError ||
    inventory.isFetching ||
    selected.isFetching ||
    action.isPending;

  return (
    <section className="grid gap-sm" aria-label="Computers">
      <SectionHeading>Computers</SectionHeading>
      <p>Choose the default Computer used for new App configurations.</p>
      {inventory.isPending ? <p role="status">Loading Computers…</p> : null}
      {inventory.isError || selected.isError ? (
        <div role="alert">
          <p>Computer inventory or selection could not be loaded.</p>
          <Button
            onClick={() => {
              void inventory.refetch();
              void selected.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {inventory.isSuccess && inventory.data.computers.length === 0 ? (
        <p>No Computers on this page.</p>
      ) : null}
      {inventory.data !== undefined ? (
        <DataList aria-label="Computer inventory">
          {inventory.data.computers.map((computer) => (
            <DataRow key={computer.computerId} className="p-0">
              <ActionRow
                label={computer.name}
                description={
                  selected.isSuccess && selected.data === computer.computerId
                    ? "Default for new Apps"
                    : computer.computerId
                }
                trailing={
                  <div className="flex gap-sm">
                    <Button
                      aria-label={`Start ${computer.name}`}
                      disabled={unavailable}
                      onClick={() => {
                        action.mutate({
                          kind: "start",
                          computerId: computer.computerId,
                        });
                      }}
                    >
                      Start
                    </Button>
                    <Button
                      aria-label={`Use ${computer.name} for new Apps`}
                      disabled={
                        unavailable || selected.data === computer.computerId
                      }
                      onClick={() => {
                        action.mutate({
                          kind: "select",
                          computerId: computer.computerId,
                        });
                      }}
                    >
                      Use for new Apps
                    </Button>
                  </div>
                }
              />
              <InternetAccess teamId={teamId} computer={computer} port={port} />
            </DataRow>
          ))}
        </DataList>
      ) : null}
      <div className="flex gap-sm" aria-label="Computer pages">
        <Button
          disabled={unavailable || offset === 0}
          onClick={() => {
            setOffset(Math.max(0, offset - 100));
          }}
        >
          Previous
        </Button>
        <Button
          disabled={unavailable || inventory.data?.nextOffset == null}
          onClick={() => {
            const next = inventory.data?.nextOffset;
            if (next != null) setOffset(next);
          }}
        >
          Next
        </Button>
      </div>
      <form
        className="grid gap-sm"
        aria-label="Create Computer"
        onSubmit={(event) => {
          event.preventDefault();
          const requestedName = name === "" ? undefined : name;
          if (intent.current === null || intent.current.name !== requestedName)
            intent.current = {
              kind: "create",
              name: requestedName,
              requestId: requestIds.request.generate(),
            };
          action.mutate(intent.current);
        }}
      >
        <label>
          Computer name (optional)
          <Input
            name="computerName"
            maxLength={256}
            value={name}
            disabled={unavailable}
            placeholder="Leave blank for a generated name"
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
          />
        </label>
        <Button type="submit" disabled={unavailable}>
          Create Computer
        </Button>
      </form>
      {action.isError ? <p role="alert">{action.error.message}</p> : null}
      {action.isSuccess ? (
        <p role="status">Computer request completed.</p>
      ) : null}
    </section>
  );
}
