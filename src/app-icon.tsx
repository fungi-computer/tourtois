import { Monogram } from "@fungi.computer/caps/components/monogram";
import { isSigilName, Sigil, type SigilName } from "@fungi.computer/sigils";

/**
 * Shell marks follow a declared role when one is known; roleless Apps use their
 * own declared Sigil name.
 */
const roleSigils: ReadonlyMap<string, SigilName> = new Map([
  ["sessions", "chat"],
  ["inbox", "chat"],
  ["files", "inkcap"],
  ["media", "prints"],
  ["terminal", "computer"],
]);

/** The App's role Sigil, then its declared icon when the role has no mark. */
export function AppIcon({
  roles,
  icon,
}: {
  roles: readonly string[];
  icon?: string | null | undefined;
}): React.JSX.Element {
  const sigil = roles
    .map((role) => roleSigils.get(role))
    .find((name) => name !== undefined);
  if (sigil) return <Sigil name={sigil} />;
  return <DeclaredAppIcon icon={icon} />;
}

/** An App keeps its declared mark, or a neutral placeholder. */
export function DeclaredAppIcon({
  icon,
}: {
  icon?: string | null | undefined;
}): React.JSX.Element {
  return icon && isSigilName(icon) ? (
    <Sigil name={icon} />
  ) : (
    <Monogram name="?" subject="app" />
  );
}
