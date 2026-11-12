import {
  DataList,
  DataListHeading,
  DataRow,
} from "@fungi.computer/caps/components/data-list";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import type {
  WebsiteConversation,
  WebsiteTranscript,
} from "@fungi.computer/nacre/website-channels";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

/** One reply that never reached its member, as the owner is told. */
export type ChannelProblem = Readonly<{
  id: string;
  /** Who was waiting. */
  label: string;
  at: number;
  /** Why it did not arrive, in a sentence. */
  reason: string;
}>;

/**
 * What one channel's owner reads: the conversations its Agent had, and any
 * one transcript on request. Website and Discord share it; each host port
 * brings its own cache keys, reads and words for the other party.
 */
export function ChannelConversations({
  keys,
  load,
  read,
  speaker,
  empty,
  label,
  problems,
}: {
  keys: Readonly<{
    list: readonly unknown[];
    transcript: (sessionId: string) => readonly unknown[];
  }>;
  load: () => Promise<readonly WebsiteConversation[]>;
  read: (sessionId: string) => Promise<WebsiteTranscript>;
  /** What the party on the other side is called in a transcript. */
  speaker: string;
  /** What to say when nobody has written yet. */
  empty: string;
  /** Names the list for assistive technology. */
  label: string;
  /** Replies the channel owed and could not deliver; absent where there are none to report. */
  problems?: Readonly<{
    key: readonly unknown[];
    load: () => Promise<readonly ChannelProblem[]>;
  }>;
}) {
  const [shown, setShown] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const list = useQuery({
    queryKey: keys.list,
    enabled: shown,
    retry: false,
    queryFn: load,
  });
  const undelivered = useQuery({
    queryKey: problems?.key ?? [],
    enabled: shown && problems !== undefined,
    retry: false,
    queryFn: () => problems?.load() ?? Promise.resolve([]),
  });
  const transcript = useQuery({
    queryKey: keys.transcript(reading ?? ""),
    enabled: reading !== null,
    retry: false,
    queryFn: () =>
      reading === null
        ? Promise.reject(new Error("No conversation is open"))
        : read(reading),
  });
  return (
    <section className="grid gap-sm" aria-label="Conversations">
      <DataListHeading level={3}>Conversations</DataListHeading>
      {shown ? null : (
        <KeycapButton
          density="compact"
          label="Show conversations"
          onClick={() => {
            setShown(true);
          }}
        />
      )}
      {list.isPending && shown ? <p role="status">Loading…</p> : null}
      {list.isError ? (
        <p role="alert">Conversations could not be loaded.</p>
      ) : null}
      {list.data?.length === 0 ? <p className="text-sm">{empty}</p> : null}
      {list.data !== undefined && list.data.length > 0 ? (
        <DataList density="compact" aria-label={label}>
          {list.data.map((conversation) => (
            <DataRow key={conversation.sessionId}>
              <div className="tourtois-conversation">
                <div className="tourtois-conversation-row">
                  <span className="tourtois-conversation-name text-sm">
                    {conversation.label}
                  </span>
                  <span className="flex flex-wrap items-center gap-sm">
                    <span className="text-sm">
                      {new Date(conversation.lastEventAt).toLocaleString()}
                    </span>
                    <KeycapButton
                      density="compact"
                      label={
                        reading === conversation.sessionId
                          ? "Close transcript"
                          : "Read transcript"
                      }
                      aria-label={`${reading === conversation.sessionId ? "Close" : "Read"} transcript of ${conversation.label}`}
                      onClick={() => {
                        setReading(
                          reading === conversation.sessionId
                            ? null
                            : conversation.sessionId,
                        );
                      }}
                    />
                  </span>
                </div>
                {reading === conversation.sessionId ? (
                  <div className="tourtois-conversation-transcript">
                    {transcript.isPending ? (
                      <p role="status">Loading…</p>
                    ) : null}
                    {transcript.isError ? (
                      <p role="alert">This conversation could not be read.</p>
                    ) : null}
                    {transcript.data ? (
                      <ol aria-label="Transcript" className="grid gap-xs">
                        {transcript.data.lines.map((line, index) => (
                          <li
                            key={`${String(index)}-${line.role}`}
                            className="text-sm"
                          >
                            <strong>
                              {line.role === "visitor" ? speaker : "Agent"}:
                            </strong>{" "}
                            {line.text}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </DataRow>
          ))}
        </DataList>
      ) : null}
      {undelivered.data !== undefined && undelivered.data.length > 0 ? (
        <section className="grid gap-xs" aria-label="Replies not delivered">
          <DataListHeading level={3}>Not delivered</DataListHeading>
          <DataList density="compact" aria-label="Replies not delivered">
            {undelivered.data.map((problem) => (
              <DataRow key={problem.id}>
                <div className="tourtois-conversation">
                  <div className="tourtois-conversation-row">
                    <span className="tourtois-conversation-name text-sm">
                      {problem.label}
                    </span>
                    <span className="text-sm">
                      {new Date(problem.at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm">{problem.reason}</p>
                </div>
              </DataRow>
            ))}
          </DataList>
        </section>
      ) : null}
    </section>
  );
}
