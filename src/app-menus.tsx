import { Button } from "@fungi.computer/caps/components/button";
import type { AppSurfaceCommandHost } from "@fungi.computer/oyster/shell/command-host";
import type {
  WhistleExecutionOutcome,
  WhistleMenuProjection,
} from "@fungi.computer/whistle";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@fungi.computer/caps/components/dropdown-menu";

const emptyMenu: readonly WhistleMenuProjection[] = Object.freeze([]);
const noSubscription = () => () => undefined;

function outcomeMessage(outcome: WhistleExecutionOutcome): string | null {
  if (outcome.status === "handled") return null;
  if (outcome.status === "unavailable") return outcome.reason;
  if (outcome.status === "failed") return outcome.error.message;
  if (outcome.status === "closed") return "This App has closed.";
  return "This App action is no longer available.";
}

/** Render the focused App's Whistle commands in the desktop's system bar. */
export function AppMenus({
  host,
  container: popover,
}: Readonly<{
  host: Pick<AppSurfaceCommandHost, "subscribe" | "menu" | "execute"> | null;
  container: HTMLElement | null;
}>): React.JSX.Element | null {
  const menu = useSyncExternalStore(
    host?.subscribe ?? noSubscription,
    host?.menu ?? (() => emptyMenu),
    () => emptyMenu,
  );
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const invocation = useRef<AbortController | null>(null);
  const categories = useMemo(() => {
    const grouped = new Map<string, WhistleMenuProjection[]>();
    for (const command of menu) {
      // This menu invokes argument-free actions. Typed handoffs remain in the
      // host graph for programmatic discovery, not as broken clickable rows.
      if (command.action?.inputSchema !== undefined) continue;
      const commands = grouped.get(command.category) ?? [];
      commands.push(command);
      grouped.set(command.category, commands);
    }
    return [...grouped];
  }, [menu]);
  useEffect(() => {
    invocation.current?.abort();
    invocation.current = null;
    setPending(null);
    setMessage(null);
    return () => {
      invocation.current?.abort();
      invocation.current = null;
    };
  }, []);

  if (!host || categories.length === 0) return null;
  return (
    <>
      {categories.map(([category, commands]) => (
        <DropdownMenu key={category} modal={false}>
          <DropdownMenuTrigger
            render={<Button size="menubar" variant="ghost" />}
          >
            {category}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            finalFocus={false}
            container={popover}
          >
            {commands.map((command) => {
              const unavailable = command.availability.status === "unavailable";
              return (
                <DropdownMenuItem
                  key={command.commandId}
                  disabled={pending !== null || unavailable}
                  title={
                    unavailable
                      ? command.availability.reason
                      : command.description
                  }
                  onSelect={() => {
                    const controller = new AbortController();
                    invocation.current = controller;
                    setPending(command.commandId);
                    setMessage(null);
                    void host
                      .execute(command.commandId, {
                        origin: "menu",
                        signal: controller.signal,
                      })
                      .then((outcome) => {
                        if (invocation.current === controller)
                          setMessage(outcomeMessage(outcome));
                      })
                      .catch((cause: unknown) => {
                        console.error("App command failed", cause);

                        if (
                          invocation.current === controller &&
                          !controller.signal.aborted
                        )
                          setMessage("This App action failed.");
                      })
                      .finally(() => {
                        if (invocation.current !== controller) return;
                        invocation.current = null;
                        setPending(null);
                      });
                  }}
                >
                  {command.title}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      {message ? (
        <span className="tourtois-system-command-status" role="status">
          {message}
        </span>
      ) : null}
    </>
  );
}
