import type {
  ShiitakeAgent,
  SessionSummary,
} from "@fungi.computer/shiitake/client";

/**
 * Retained inbox startup: latest update wins; merely opening never touches
 * recency. An unreadable Session carries no recency and is never selected.
 */
export async function latestSession(
  client: Pick<ShiitakeAgent, "listSessions">,
): Promise<string | null> {
  let latest: (SessionSummary & { sessionId: string }) | undefined;
  let after: string | undefined;
  do {
    const page = await client.listSessions(after);
    for (const session of page.sessions) {
      if (session.state === "unavailable") continue;
      if (
        !latest ||
        session.lastActivityAt > latest.lastActivityAt ||
        (session.lastActivityAt === latest.lastActivityAt &&
          session.sessionId < latest.sessionId)
      )
        latest = session;
    }
    after = page.next;
  } while (after !== undefined);
  return latest?.sessionId ?? null;
}
