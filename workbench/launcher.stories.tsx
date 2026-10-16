import type { StoryDefault } from "@ladle/react";
import { useState } from "react";
import { Sigil } from "@fungi.computer/sigils";
import type { AppGillDesktopSize } from "@fungi.computer/gills";
import { LauncherGill } from "../src/desktop/launcher-gill.js";

export default { title: "Desktop/Launcher" } satisfies StoryDefault;
function Launcher({ size }: { size: AppGillDesktopSize }) {
  const [preferences, setPreferences] = useState<{
    pinned: string[];
    hidden: string[];
  }>({ pinned: [], hidden: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const items = ["Inkcap", "Grove", "Prints", "Shed"].map((label) => ({
    id: label,
    label,
    icon: <Sigil name="installApps" />,
    onSelect: () => {
      setSelected(label);
    },
  }));
  return (
    <>
      <LauncherGill
        preferences={preferences}
        onPreference={(id, state) => {
          setPreferences((current) => ({
            pinned: [
              ...current.pinned.filter((value) => value !== id),
              ...(state === "Pinned" ? [id] : []),
            ],
            hidden: [
              ...current.hidden.filter((value) => value !== id),
              ...(state === "Hidden" ? [id] : []),
            ],
          }));
        }}
        items={items}
        size={size}
        onAllApps={() => {
          setSelected("All Apps dial");
        }}
      />
      {selected ? <p role="status">Host requested: {selected}</p> : null}
    </>
  );
}
export function Small() {
  return <Launcher size="S" />;
}
export function Medium() {
  return <Launcher size="M" />;
}
export function Large() {
  return <Launcher size="L" />;
}
export function Loading() {
  return (
    <LauncherGill
      preferences={{ pinned: [], hidden: [] }}
      onPreference={() => undefined}
      items={[]}
      loading
      onAllApps={() => undefined}
    />
  );
}
export function Unavailable() {
  return (
    <LauncherGill
      preferences={{ pinned: [], hidden: [] }}
      onPreference={() => undefined}
      items={[]}
      unavailable
      onRetry={() => undefined}
      onAllApps={() => undefined}
    />
  );
}
export function Empty() {
  return (
    <LauncherGill
      preferences={{ pinned: [], hidden: [] }}
      onPreference={() => undefined}
      items={[]}
      onAllApps={() => undefined}
    />
  );
}
