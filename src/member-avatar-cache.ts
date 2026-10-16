import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import {
  defaultMemberAvatar,
  memberAvatarSchema,
  type MemberAvatar,
} from "@fungi.computer/sprite-zdog/avatar";

const storageKey = "fungi.member.avatar.v1";

/** Memory fallback lasts for this page; it does not claim durable storage. */
type AvatarCacheOutcome =
  | { readonly kind: "persistent" }
  | { readonly kind: "memory"; readonly stage: "read" | "write" };

/** Guard acquisition as well as use: a sandbox may throw on the getter itself. */
export function createMemberAvatarCache(
  storage: () => Pick<Storage, "getItem" | "setItem">,
) {
  const listeners = new Set<() => void>();
  let outcome: AvatarCacheOutcome = { kind: "persistent" };
  let cachedRaw: string | null | undefined;
  let cached = defaultMemberAvatar;

  function snapshot(): MemberAvatar {
    if (outcome.kind === "memory") return cached;
    let raw: string | null;
    try {
      raw = storage().getItem(storageKey);
    } catch (cause) {
      outcome = { kind: "memory", stage: "read" };
      console.warn("Member avatar using memory cache", outcome, cause);
      return cached;
    }
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    const decoded = Schema.decodeUnknownOption(
      Schema.fromJsonString(Schema.Unknown),
    )(raw);
    const parsed = Option.isSome(decoded)
      ? memberAvatarSchema.safeParse(decoded.value)
      : undefined;
    cached = parsed?.success ? parsed.data : defaultMemberAvatar;
    return cached;
  }

  function write(next: MemberAvatar): AvatarCacheOutcome {
    const value = memberAvatarSchema.parse(next);
    const raw = JSON.stringify(value);
    snapshot();
    if (raw === cachedRaw) return outcome;
    if (outcome.kind === "persistent") {
      try {
        storage().setItem(storageKey, raw);
      } catch (cause) {
        outcome = { kind: "memory", stage: "write" };
        console.warn("Member avatar using memory cache", outcome, cause);
      }
    }
    cachedRaw = raw;
    cached = value;
    for (const listener of listeners) listener();
    return outcome;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (
        outcome.kind === "persistent" &&
        (event.key === storageKey || event.key === null)
      ) {
        listener();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return { snapshot, write, subscribe };
}
