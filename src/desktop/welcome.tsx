import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { AppStorage } from "@fungi.computer/agar/storage";
import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import { Button } from "@fungi.computer/caps/components/button";
import { Keycap } from "@fungi.computer/caps/components/keycap";
import { starterItem } from "./starter-item.js";
import { ShiitakeAvatar } from "@fungi.computer/parakeet/agent-head";

const welcomeKey = "welcome";
const dismissedSchema = z.object({ dismissed: z.literal(true) });

export type WelcomeState = Readonly<{
  /** True only once storage has answered that this member has not dismissed it. */
  visible: boolean;
  dismiss: () => void;
}>;

const hidden: WelcomeState = { visible: false, dismiss: () => undefined };
const WelcomeContext = createContext<WelcomeState>(hidden);

/** The per-member first-run welcome, remembered in the member's own storage layer. */
export function WelcomeProvider({
  teamId,
  storage,
  children,
}: {
  teamId: string;
  storage: AppStorage;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const queryKey = useMemo(() => ["tourtois", "welcome", teamId], [teamId]);
  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const resolved = await storage.read(welcomeKey);
      return {
        revision: resolved.member?.revision ?? null,
        dismissed: dismissedSchema.safeParse(resolved.member?.value).success,
      };
    },
  });
  const dismiss = useCallback(() => {
    client.setQueryData(queryKey, {
      revision: data?.revision ?? null,
      dismissed: true,
    });
    void storage
      .write({
        key: welcomeKey,
        scope: "member",
        basedOn: data?.revision ?? null,
        value: { dismissed: true },
      })
      .catch((cause: unknown) => {
        console.error("Welcome dismissal was not saved", cause);
      });
  }, [client, data?.revision, queryKey, storage]);
  const value = useMemo<WelcomeState>(
    () => ({ visible: data !== undefined && !data.dismissed, dismiss }),
    [data, dismiss],
  );
  return (
    <WelcomeContext.Provider value={value}>{children}</WelcomeContext.Provider>
  );
}

export const useWelcome = (): WelcomeState => useContext(WelcomeContext);

const isMac = () => /Mac|iPhone|iPad/u.test(navigator.userAgent);

/** Says what this place is and points at the one thing to do next. */
export function FirstRunWelcome({
  items,
  onDismiss,
}: {
  items: readonly AppBarItem[];
  onDismiss: () => void;
}) {
  const hello = starterItem(items, "hello");
  // Grove is the first thing to try; until it is installed, Hello is. Never
  // whichever App sorts first among the rest.
  const lead = starterItem(items, "grove") ?? hello;
  if (!lead) return null;
  return (
    <section
      className="tourtois-welcome"
      aria-labelledby="tourtois-welcome-title"
    >
      <span className="tourtois-welcome-mascot" aria-hidden="true">
        <ShiitakeAvatar
          className="h-full w-full"
          state={{ activity: "idle", expression: "normal" }}
        />
      </span>
      <div className="tourtois-welcome-text">
        <h3 id="tourtois-welcome-title">This is your Oyster</h3>
        <p>
          A place to talk to Agents, make things, and keep your work together.
        </p>
        <p className="tourtois-welcome-hint">
          <Keycap size="hint">{isMac() ? "⌘" : "Ctrl"}</Keycap>{" "}
          <Keycap size="hint">K</Keycap> then <Keycap size="hint">O</Keycap>{" "}
          opens any App
        </p>
      </div>
      <div className="tourtois-welcome-actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            lead.onSelect();
          }}
        >
          Open {lead.label}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
