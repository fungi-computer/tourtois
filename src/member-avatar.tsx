import { SectionHeading } from "@fungi.computer/caps/blocks/section-heading";
import {
  memberAvatarSchema,
  defaultMemberAvatar,
  type MemberAvatar,
} from "@fungi.computer/sprite-zdog/avatar";
import type { RenderStyle } from "@fungi.computer/sprite";
import { AvatarPreview } from "./AvatarPreview.js";
import { AvatarPicker } from "./AvatarPicker.js";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { WhistleJsonValue } from "@fungi.computer/whistle";
import { createMemberAvatarCache } from "./member-avatar-cache.js";

/**
 * The person's avatar preference. The host's account owns it; this browser
 * keeps the last value it saw as an offline cache so the sprite draws before,
 * or without, an account read. Both sources are untrusted and parsed with the
 * avatar preference schema; anything that does not parse is the defaults.
 */
const cache = createMemberAvatarCache(() => localStorage);

/** Decode the host-granted avatar preference. */
export const parseMemberAvatar = (
  value: WhistleJsonValue,
): MemberAvatar | null => memberAvatarSchema.nullable().parse(value);

/** Account edits and host settings changes invalidate this query. */
export const accountAvatarQuery = ["tourtois", "account-avatar"] as const;

/** Save the person's avatar through the host's account; returns the saved value. */
export type MemberAvatarSave = (next: MemberAvatar) => Promise<MemberAvatar>;

/** Read the person's saved avatar, parsed by the reader. */
export type MemberAvatarReader = (
  signal: AbortSignal,
) => Promise<MemberAvatar | null>;
const MemberAvatarReaderContext = createContext<MemberAvatarReader | null>(
  null,
);

/**
 * Read the avatar through a host-granted source: an isolated dashboard's
 * capability, or the host's own account read. Without one, the sprite draws
 * from this browser's cache.
 */
export function MemberAvatarSource({
  read,
  children,
}: {
  read: MemberAvatarReader;
  children: ReactNode;
}) {
  return (
    <MemberAvatarReaderContext.Provider value={read}>
      {children}
    </MemberAvatarReaderContext.Provider>
  );
}

/**
 * The current avatar: the account's value once read (refreshing the
 * cache), otherwise the cached value, updated across tabs.
 */
export function useMemberAvatar(): MemberAvatar {
  const read = useContext(MemberAvatarReaderContext);
  const account = useQuery({
    queryKey: accountAvatarQuery,
    queryFn: read === null ? skipToken : ({ signal }) => read(signal),
    retry: false,
    staleTime: 60_000,
  });
  const fromAccount = account.data;
  useEffect(() => {
    if (fromAccount) cache.write(fromAccount);
  }, [fromAccount]);
  const local = useSyncExternalStore(
    cache.subscribe,
    cache.snapshot,
    () => defaultMemberAvatar,
  );
  return fromAccount ?? local;
}

/** Save through the host; the cache takes the new value at once. */
function useSaveMemberAvatar(save: MemberAvatarSave) {
  const client = useQueryClient();
  return useMutation({
    onMutate: async (next: MemberAvatar) => {
      await client.cancelQueries({ queryKey: accountAvatarQuery });
      const previous = client.getQueryData<MemberAvatar | null>(
        accountAvatarQuery,
      );
      const local = cache.snapshot();
      cache.write(next);
      const optimistic = client.setQueryData(accountAvatarQuery, next);
      return { previous, local, optimistic };
    },
    mutationFn: save,
    onError: (_cause, _next, snapshot) => {
      if (
        snapshot &&
        client.getQueryData(accountAvatarQuery) === snapshot.optimistic
      ) {
        client.setQueryData(accountAvatarQuery, snapshot.previous ?? null);
        cache.write(snapshot.local);
      }
    },
    onSuccess: (saved) => {
      client.setQueryData(accountAvatarQuery, saved);
      cache.write(saved);
    },
  });
}

/** The person's sprite as the shell presents it: saved style and appearance. */
export function OwnSprite(props: {
  readonly activity?: string;
  readonly expression?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly renderStyle?: RenderStyle;
  readonly "aria-hidden"?: "true";
}) {
  const saved = useMemberAvatar().avatar;
  const { renderStyle, ...rest } = props;
  return (
    <AvatarPreview
      avatar={{ ...saved, renderStyle: renderStyle ?? saved.renderStyle }}
      {...rest}
    />
  );
}

/** Host-rendered picker: Apps read the preference but never write account routes. */
export function AvatarSettings({ save: write }: { save: MemberAvatarSave }) {
  const saved = useMemberAvatar();
  const save = useSaveMemberAvatar(write);
  return (
    <section
      className="tourtois-avatar-settings"
      aria-labelledby="tourtois-avatar-heading"
    >
      <SectionHeading id="tourtois-avatar-heading">Avatar</SectionHeading>
      <p className="tourtois-settings-lede">
        Choose your character, colours and drawing style. Changes save
        automatically.
      </p>
      {save.isError ? (
        <p role="alert">
          Your account did not save this avatar. Your previous avatar was
          restored. Choose it again to retry.
        </p>
      ) : null}
      <AvatarPicker
        value={saved}
        disabled={save.isPending}
        onChange={(next) => {
          save.mutate(next);
        }}
      />
    </section>
  );
}
