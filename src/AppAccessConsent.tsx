import type {
  AgentAccessOperation,
  AppPermissionOutcome,
  AppPermissionRequest,
  ComputerAccessOperation,
  EventAccessOperation,
  GenerationAccessOperation,
  GitAccessOperation,
  WorkflowAccessOperation,
} from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { WindowFrame } from "@fungi.computer/caps/components/window";
import { useRef, useState } from "react";
import type {
  AppAgentPermission,
  AppComputerPermission,
} from "@fungi.computer/nacre/app-directory";

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

/** Plain words for the Git, Workflow, event and generation rights. */
const otherRightNames = {
  "git.repository": "save its work in Git repositories",
  "workflow.publish": "publish workflows",
  "workflow.arm": "let workflows start on their own",
  "workflow.run": "run workflows",
  "app.events.emit": "send events to your other Apps",
  "llm.generation": "write with an AI model",
  "media.generation": "make images and videos",
  "media.share": "share what it makes",
} as const satisfies Record<
  | GitAccessOperation
  | WorkflowAccessOperation
  | EventAccessOperation
  | GenerationAccessOperation,
  string
>;

/** Every right the request names, in plain words, in a stable order. */
export function plainRights(request: {
  agents: readonly AgentAccessOperation[];
  computers: readonly ComputerAccessOperation[];
  others?: AppPermissionRequest | undefined;
}): readonly string[] {
  const others = request.others;
  const named: readonly string[] = [
    ...(others?.git ?? []),
    ...(others?.workflows ?? []),
    ...(others?.events ?? []),
    ...(others?.generation ?? []),
  ];
  const agentRights = agentOperations
    .filter((operation) => request.agents.includes(operation))
    .map((operation) => rightNames[operation]);
  const computerRights = computerOperations
    .filter((operation) => request.computers.includes(operation))
    .map((operation) => rightNames[operation]);
  const otherRights = Object.entries(otherRightNames)
    .filter(([operation]) => named.includes(operation))
    .map(([, words]) => words);
  return [...agentRights, ...computerRights, ...otherRights];
}

export type AppAccessRequest = Readonly<{
  appName: string;
  agents: readonly AgentAccessOperation[];
  computers: readonly ComputerAccessOperation[];
  /** Git, Workflow, event and generation rights asked for in the same request. */
  others?: AppPermissionRequest | undefined;
  /** A host refusal is visible and cannot be converted into an Allow. */
  refusal?: Readonly<{ code: string; message: string }>;
  /** Save the grant through the owner's own authority; resolves false when it failed. */
  allow: () => Promise<boolean>;
  settle: (outcome: AppPermissionOutcome) => void;
}>;

/** One-click host consent: one sheet listing every right in plain words. */
export function AppAccessConsent({
  request,
}: {
  request: AppAccessRequest | null;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const approve = useRef<HTMLButtonElement>(null);
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
        initialFocus={approve}
      >
        <div className="tourtois-app-consent-body">
          <DialogTitle>
            {request ? `Approve ${request.appName}'s permissions?` : ""}
          </DialogTitle>
          <DialogDescription>
            {request ? `${request.appName} would like to:` : ""}
          </DialogDescription>
          {request !== null ? (
            <ul className="tourtois-app-consent-rights text-sm">
              {plainRights(request).map((right) => (
                <li key={right}>{right}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm">
            You can change this later in System Settings.
          </p>
          {request?.refusal !== undefined ? (
            <p role="alert" data-refusal-code={request.refusal.code}>
              {request.refusal.message}
            </p>
          ) : null}
          {failed ? (
            <p role="alert">Access could not be saved. Try again.</p>
          ) : null}
          <DialogFooter className="tourtois-app-consent-footer">
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                settle("customize");
              }}
            >
              Customize…
            </Button>
            <div className="tourtois-app-consent-decision">
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
                ref={approve}
                disabled={
                  saving || request === null || request.refusal !== undefined
                }
                onClick={() => {
                  if (request === null || request.refusal !== undefined) return;
                  setSaving(true);
                  setFailed(false);
                  void request.allow().then(
                    (saved) => {
                      settle(saved ? "granted" : "declined");
                    },
                    () => {
                      setSaving(false);
                      setFailed(true);
                    },
                  );
                }}
              >
                {saving ? "Approving…" : "Approve"}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
