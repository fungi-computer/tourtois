import type {
  AgentAccessOperation,
  AppPermissionOutcome,
  ComputerAccessOperation,
} from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import {
  WindowFrame,
  WindowHeader,
} from "@fungi.computer/caps/components/window";
import { useState } from "react";
import type {
  AppAgentPermission,
  AppComputerPermission,
} from "@fungi.computer/oyster/shell/app-directory";

const directoryOperations = ["agent.list"] as const;
const sessionOperations = ["agent.read", "agent.send", "agent.manage"] as const;
const agentOperations: readonly AgentAccessOperation[] = [
  "agent.list",
  "agent.manage",
  "agent.read",
  "agent.send",
];
const computerOperations: readonly ComputerAccessOperation[] = [
  "computer.list",
  "computer.readFile",
  "computer.writeFile",
  "computer.execute",
];

/** What the trusted host may offer: the request bounded by the declared ceiling. */
function consentableOperations<Operation extends string>(
  known: readonly Operation[],
  requested: readonly Operation[],
  declared: readonly string[],
): readonly Operation[] {
  return known.filter(
    (operation) =>
      requested.includes(operation) && declared.includes(operation),
  );
}

export const consentableAgentOperations = (
  requested: readonly AgentAccessOperation[],
  declared: readonly string[],
) => consentableOperations(agentOperations, requested, declared);

export const consentableComputerOperations = (
  requested: readonly ComputerAccessOperation[],
  declared: readonly string[],
) => consentableOperations(computerOperations, requested, declared);

/** The all-Team-Agents grant that adds `offered` to the current policy. */
export function consentedAgentPermission(
  current: AppAgentPermission,
  offered: readonly AgentAccessOperation[],
): AppAgentPermission | "covered" | "customize" {
  if (current.kind === "selected-agents") return "customize";
  const currentOperations: readonly string[] = [
    ...current.directoryOperations,
    ...current.sessionOperations,
  ];
  if (offered.every((operation) => currentOperations.includes(operation)))
    return "covered";
  const granted = new Set<string>([...currentOperations, ...offered]);
  return {
    kind: "all-team-agents",
    directoryOperations: directoryOperations.filter((operation) =>
      granted.has(operation),
    ),
    sessionOperations: sessionOperations.filter((operation) =>
      granted.has(operation),
    ),
  };
}

/**
 * The all-Team-Computers grant that adds `offered`. An empty selection is no
 * access; a real Computer selection is the owner's choice and never widened.
 */
export function consentedComputerPermission(
  current: AppComputerPermission | null,
  offered: readonly ComputerAccessOperation[],
): AppComputerPermission | "covered" | "customize" {
  if (current?.kind === "selected-computers" && current.computers.length > 0)
    return "customize";
  const currentOperations: readonly string[] =
    current?.kind === "all-team-computers" ? current.operations : [];
  if (offered.every((operation) => currentOperations.includes(operation)))
    return "covered";
  const granted = new Set<string>([...currentOperations, ...offered]);
  return {
    kind: "all-team-computers",
    operations: computerOperations.filter((operation) =>
      granted.has(operation),
    ),
  };
}

/** Sentence variants following "<App> can" in the consent description. */
const rightNames = {
  "agent.list": "see your Agents",
  "agent.manage": "create and manage Agents and their sessions",
  "agent.read": "read their conversations",
  "agent.send": "send messages",
  "computer.list": "see your Computers",
  "computer.readFile": "read their files",
  "computer.writeFile": "change their files",
  "computer.execute": "run commands on them",
} as const satisfies Record<
  AgentAccessOperation | ComputerAccessOperation,
  string
>;

const describe = (
  offered: readonly (AgentAccessOperation | ComputerAccessOperation)[],
) => {
  const rights = [...agentOperations, ...computerOperations]
    .filter((operation) => offered.includes(operation))
    .map((operation) => rightNames[operation]);
  const last = rights.at(-1) ?? "";
  return rights.length < 2
    ? last
    : `${rights.slice(0, -1).join(", ")} and ${last}`;
};

export type AppAccessRequest = Readonly<{
  appName: string;
  agents: readonly AgentAccessOperation[];
  computers: readonly ComputerAccessOperation[];
  /** Save the grant through the owner's own authority; resolves false when it failed. */
  allow: () => Promise<boolean>;
  settle: (outcome: AppPermissionOutcome) => void;
}>;

const resources = (
  request: AppAccessRequest,
  agent: string,
  computer: string,
) =>
  [
    request.agents.length > 0 ? agent : null,
    request.computers.length > 0 ? computer : null,
  ]
    .filter((resource) => resource !== null)
    .join(" and ");

/** One-click host consent for the rights a default App declared. */
export function AppAccessConsent({
  request,
}: {
  request: AppAccessRequest | null;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const settle = (outcome: AppPermissionOutcome) => {
    setSaving(false);
    setFailed(false);
    request?.settle(outcome);
  };
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next && !saving) settle("declined");
      }}
    >
      <DialogContent
        render={<WindowFrame floating />}
        keepMounted={false}
        className="tourtois-app-consent"
      >
        <WindowHeader title="App access" />
        <div className="tourtois-app-consent-body">
          <DialogTitle>
            {request
              ? `Let ${request.appName} work with your ${resources(request, "Agents", "Computers")}?`
              : ""}
          </DialogTitle>
          <DialogDescription>
            {request
              ? `${request.appName} can ${describe([...request.agents, ...request.computers])} for every ${resources(request, "Agent", "Computer")} in this Oyster. You can change this later in System Settings.`
              : ""}
          </DialogDescription>
          {failed ? (
            <p role="alert">Access could not be saved. Try again.</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                settle("customize");
              }}
            >
              Customize…
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                settle("declined");
              }}
            >
              Not now
            </Button>
            <Button
              disabled={saving || request === null}
              onClick={() => {
                if (request === null) return;
                setSaving(true);
                setFailed(false);
                void request.allow().then(
                  (saved) => {
                    if (saved) settle("granted");
                    else {
                      setSaving(false);
                      setFailed(true);
                    }
                  },
                  () => {
                    setSaving(false);
                    setFailed(true);
                  },
                );
              }}
            >
              {saving ? "Allowing…" : "Allow"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
