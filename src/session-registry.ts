import type { ShiitakeAgent } from "@fungi.computer/shiitake/client";
import { latestSession } from "./session-selection.js";
import { requestIds } from "./team-directory.js";
import { useCallback, useEffect, useRef, useState } from "react";

export type SessionClient<TSession> = Pick<
  ShiitakeAgent,
  "listSessions" | "createSession"
> &
  Readonly<{
    close: () => Promise<void>;
    session: (sessionId: string) => TSession;
  }>;

export type SessionClientFactory<TSession> = (
  agentId: string,
) => SessionClient<TSession>;

type SessionRegistry<TSession> = {
  teamId: string;
  clients: Map<string, SessionClient<TSession>>;
  sessions: Map<string, TSession>;
  pendingCreates: Map<string, string>;
};

/**
 * Own one Team's client/session generation from effect setup through cleanup.
 * The render waits for setup so React StrictMode can rehearse and replace the
 * generation without handing a child a client that cleanup already closed.
 */
export function useSessionRegistry<TSession>(
  teamId: string,
  createClient: SessionClientFactory<TSession>,
) {
  const registryRef = useRef<SessionRegistry<TSession>>();
  const [, rerenderAfterSetup] = useState(0);

  useEffect(() => {
    const registry: SessionRegistry<TSession> = {
      teamId,
      clients: new Map(),
      sessions: new Map(),
      pendingCreates: new Map(),
    };
    registryRef.current = registry;
    rerenderAfterSetup((version) => version + 1);
    return () => {
      void Promise.allSettled(
        [...registry.clients.values()].map((client) => client.close()),
      );
      if (registryRef.current === registry) registryRef.current = undefined;
    };
  }, [createClient, teamId]);

  const clientFor = useCallback(
    (agentId: string) => {
      const registry = registryRef.current;
      if (registry?.teamId !== teamId)
        throw new Error("Tourtois Team client registry is unavailable");
      let client = registry.clients.get(agentId);
      if (!client) {
        client = createClient(agentId);
        registry.clients.set(agentId, client);
      }
      return { client, registry };
    },
    [createClient, teamId],
  );

  const sessionFor = useCallback(
    (agentId: string, sessionId: string): TSession => {
      const { client, registry } = clientFor(agentId);
      const key = `${agentId}\u0000${sessionId}`;
      const existing = registry.sessions.get(key);
      if (existing) return existing;
      const session = client.session(sessionId);
      registry.sessions.set(key, session);
      return session;
    },
    [clientFor],
  );

  const selectSession = useCallback(
    async (agentId: string): Promise<string> => {
      const { client, registry } = clientFor(agentId);
      const latest = await latestSession(client);
      if (registryRef.current !== registry)
        throw new Error("Chat selection changed");
      let sessionId = latest;
      if (sessionId === null) {
        const requestId =
          registry.pendingCreates.get(agentId) ?? requestIds.request.generate();
        registry.pendingCreates.set(agentId, requestId);
        sessionId = await client.createSession(requestId);
      }
      if (registryRef.current !== registry)
        throw new Error("Chat selection changed");
      registry.pendingCreates.delete(agentId);
      return sessionId;
    },
    [clientFor],
  );

  return {
    ready: registryRef.current?.teamId === teamId,
    sessionFor,
    selectSession,
  };
}
