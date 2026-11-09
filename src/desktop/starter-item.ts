import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";

/**
 * The launcher item for an installed starter App. A host names a surface by its
 * address key (`installation:<id>`), so the item id is `app:installation:<id>`;
 * the workbench stories name theirs by the bare App id.
 */
export function starterItem(
  items: readonly AppBarItem[],
  installationId: string,
): AppBarItem | undefined {
  return (
    items.find((item) => item.id === `app:installation:${installationId}`) ??
    items.find((item) => item.id === `app:${installationId}`)
  );
}
