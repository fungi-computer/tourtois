import { useState } from "react";
import { AppGrid } from "@fungi.computer/caps/blocks/launcher-grid";
import type { AppGridItem } from "@fungi.computer/caps/blocks/launcher-grid";
import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Select } from "@fungi.computer/caps/components/select";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { Sigil } from "@fungi.computer/sigils";
import type { AppGillDesktopSize } from "@fungi.computer/gills";
import { GillFrame } from "./gill-frame.js";

/** Trusted shell Gill. Defaults to the same complete launchable set/order as the AppBar. */
export function LauncherGill({
  items,
  size = "M",
  onAllApps,
  loading = false,
  unavailable = false,
  onRetry,
  warnings = [],
  preferences,
  onPreference,
  editHandle,
  onContentHeight,
}: {
  items: readonly AppBarItem[];
  size?: AppGillDesktopSize;
  onAllApps: () => void;
  loading?: boolean;
  unavailable?: boolean;
  onRetry?: () => void;
  warnings?: readonly AppGridItem[];
  preferences: Readonly<{
    pinned: readonly string[];
    hidden: readonly string[];
  }>;
  onPreference: (id: string, state: "Pinned" | "Shown" | "Hidden") => void;
  onContentHeight?: ((height: number) => void) | undefined;
  editHandle?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const stateFor = (id: string) =>
    preferences.hidden.includes(id)
      ? "Hidden"
      : preferences.pinned.includes(id)
        ? "Pinned"
        : "Shown";
  const shown = items.filter((item) => stateFor(item.id) !== "Hidden");
  const ordered = [
    ...shown.filter((item) => stateFor(item.id) === "Pinned"),
    ...shown.filter((item) => stateFor(item.id) !== "Pinned"),
  ];
  const tiles: AppGridItem[] = ordered.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    onSelect: item.onSelect,
  }));
  const ready = !loading && !unavailable;
  return (
    <GillFrame
      title="Launcher"
      size={size}
      onContentHeight={onContentHeight}
      editHandle={
        editHandle ?? (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={editing}
              onClick={() => {
                setEditing(!editing);
              }}
            >
              {editing ? "Done" : "Edit launcher"}
            </Button>
          </>
        )
      }
    >
      {loading ? <p role="status">Loading Apps…</p> : null}
      {unavailable ? (
        <p role="alert">
          App directory unavailable.{" "}
          {onRetry ? (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </p>
      ) : null}
      {ready ? (
        <>
          {items.length === 0 ? (
            <EmptyState
              variant="hint"
              title="No Apps available"
              description="Installed launchable Apps appear here."
            />
          ) : null}
          {items.length > 0 && shown.length === 0 ? (
            <p>No Apps shown. Edit the launcher to show them again.</p>
          ) : null}
          <AppGrid
            aria-label="Team Apps"
            items={[
              ...tiles,
              ...warnings,
              {
                id: "all-apps",
                label: "All Apps ›",
                icon: <Sigil name="installApps" />,
                onSelect: onAllApps,
              },
            ]}
            size="lg"
          />
          {editing ? (
            <DataList aria-label="Launcher preferences">
              {items.map((item) => (
                <DataRow key={item.id}>
                  <div className="tourtois-launcher-preference">
                    <span
                      aria-hidden="true"
                      className="grid size-6 place-items-center [&_svg]:size-full"
                    >
                      {item.icon ?? <Sigil name="installApps" />}
                    </span>
                    <div className="tourtois-launcher-preference-identity">
                      <span>{item.label}</span>
                    </div>
                    <Select
                      aria-label={`Launcher state for ${item.label}`}
                      value={stateFor(item.id)}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (
                          value !== "Pinned" &&
                          value !== "Shown" &&
                          value !== "Hidden"
                        )
                          return;
                        onPreference(item.id, value);
                      }}
                    >
                      <option value="Shown">Shown</option>
                      <option value="Pinned">Pinned</option>
                      <option value="Hidden">Hidden</option>
                    </Select>
                  </div>
                </DataRow>
              ))}
            </DataList>
          ) : null}
        </>
      ) : null}
    </GillFrame>
  );
}
