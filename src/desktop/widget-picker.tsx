import { useState, type ReactNode } from "react";
import { Input } from "@fungi.computer/caps/components/input";
import {
  Popover,
  PopoverOption,
} from "@fungi.computer/caps/components/popover";
import type { DesktopGill } from "../desktop-layout.js";

/** One placeable widget, with the App that owns it. */
export type WidgetChoice = Readonly<{
  gill: DesktopGill;
  appName: string;
  /** Already on the desktop; still choosable, listed after the rest. */
  placed: boolean;
  icon: ReactNode;
}>;

/**
 * A floating, searchable list of widgets. It never takes the page's focus
 * away from its search box and stays open so several can be added in a row.
 */
export function WidgetPicker({
  choices,
  disabled,
  onChoose,
}: {
  choices: readonly WidgetChoice[];
  disabled: boolean;
  onChoose: (gill: DesktopGill) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const needle = query.trim().toLowerCase();
  const shown = choices
    .filter((choice) =>
      `${choice.gill.title} ${choice.appName}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(a.placed) - Number(b.placed));
  const current = Math.min(active, Math.max(0, shown.length - 1));
  const choose = (choice: WidgetChoice | undefined) => {
    if (choice && !disabled) onChoose(choice.gill);
  };
  return (
    <Popover
      open
      side="top"
      className="tourtois-widget-picker"
      aria-label="Add widget"
    >
      <Input
        autoFocus
        aria-label="Search widgets"
        placeholder="Search widgets"
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(Math.min(shown.length - 1, current + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(0, current - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(shown[current]);
          }
        }}
      />
      <div role="listbox" aria-label="Widgets" className="tourtois-widget-list">
        {shown.map((choice, index) => (
          <PopoverOption
            key={`${choice.gill.surfaceId}:${choice.gill.gillId}`}
            active={index === current}
            aria-label={`${choice.gill.title}, ${choice.appName}`}
            onClick={() => {
              choose(choice);
            }}
          >
            <span aria-hidden="true" className="tourtois-widget-icon">
              {choice.icon}
            </span>
            <span className="tourtois-widget-text">
              <span>{choice.gill.title}</span>
              <small>{choice.appName}</small>
            </span>
            {choice.placed ? <small>On desktop</small> : null}
          </PopoverOption>
        ))}
        {shown.length === 0 ? (
          <p className="tourtois-widget-none">No widgets match.</p>
        ) : null}
      </div>
    </Popover>
  );
}
