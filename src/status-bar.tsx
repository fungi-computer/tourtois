import type { ReactNode } from "react";
import { useDismissOverlays } from "./layers.js";
import {
  AppStatusItem,
  StatusBarChip,
} from "@fungi.computer/caps/blocks/app-status-bar";
import { CountBadge } from "@fungi.computer/caps/components/count-badge";
import { Status } from "@fungi.computer/caps/components/status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { Activity, Check, Folder, Plug, ShieldCheck } from "lucide-react";
import type {
  AppStatusAction,
  AppStatusIcon,
  AppStatusItem as AppStatusItemData,
} from "@fungi.computer/agar";

const statusIcons = {
  folder: <Folder aria-hidden="true" />,
  ports: <Plug aria-hidden="true" />,
  processes: <Activity aria-hidden="true" />,
  access: <ShieldCheck aria-hidden="true" />,
} satisfies Record<AppStatusIcon, React.JSX.Element>;

/** One App-declared status item, drawn by the shell as a flat status chip. */
export function WindowStatusItem({
  item,
  container,
  onAction,
  anchorFor,
}: {
  item: AppStatusItemData;
  container: HTMLElement | null;
  onAction: (action: AppStatusAction) => void;
  /** Where a chip sits along the App's surface, for UI the App opens. */
  anchorFor: (key: HTMLElement) => AppStatusAction["anchor"];
}) {
  const count =
    (item.kind === "button" || item.kind === "menu") &&
    item.count !== undefined &&
    item.count > 0 ? (
      <CountBadge count={item.count} />
    ) : null;
  const light =
    item.kind === "button" &&
    (item.tone !== undefined || item.busy === true) ? (
      <Status
        size="compact"
        aria-hidden="true"
        tone={item.tone ?? "accent"}
        motion={item.busy === true ? "pulse" : "none"}
      />
    ) : undefined;
  switch (item.kind) {
    case "text":
      return item.tone === undefined ? (
        <AppStatusItem role="status">{item.text}</AppStatusItem>
      ) : (
        <Status size="compact" tone={item.tone} label={item.text} />
      );
    case "button":
      return (
        <StatusBarChip
          label={item.text}
          icon={
            item.icon === undefined && light === undefined ? undefined : (
              <>
                {item.icon === undefined ? null : statusIcons[item.icon]}
                {light}
              </>
            )
          }
          readout={count}
          title={item.title ?? item.text}
          disabled={item.disabled}
          aria-haspopup={item.opens}
          {...(item.expanded === undefined ? {} : { expanded: item.expanded })}
          onClick={(event) => {
            const anchor = anchorFor(event.currentTarget);
            onAction(
              anchor === undefined
                ? { itemId: item.id }
                : { itemId: item.id, anchor },
            );
          }}
        />
      );
    case "toggle":
      return (
        <StatusBarChip
          label={item.text}
          pressed={item.pressed}
          onClick={() => {
            onAction({ itemId: item.id });
          }}
        />
      );
    case "menu":
      // An App's menu is a plain chip: only the host's picker wears the
      // up-down mark, so an App can't pass a menu off as the Computer.
      return (
        <StatusMenu
          label={item.text}
          readout={count}
          title={item.title}
          container={container}
          options={item.options}
          onSelect={(optionId) => {
            onAction({ itemId: item.id, optionId });
          }}
        />
      );
  }
}

/** An App's menu chip; it shares the bar's one-open-popover rule. */
function StatusMenu({
  label,
  readout,
  title,
  container,
  options,
  onSelect,
}: {
  label: string;
  readout: ReactNode;
  title: string | undefined;
  container: HTMLElement | null;
  options: Extract<AppStatusItemData, { kind: "menu" }>["options"];
  onSelect: (optionId: string) => void;
}) {
  const dismissOthers = useDismissOverlays();
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) dismissOthers();
      }}
    >
      <DropdownMenuTrigger
        render={<StatusBarChip label={label} readout={readout} title={title} />}
      />
      <DropdownMenuContent container={container} align="start">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            disabled={option.disabled}
            {...(option.checked === undefined
              ? {}
              : { role: "menuitemradio", "aria-checked": option.checked })}
            onSelect={() => {
              onSelect(option.id);
            }}
          >
            <span className="flex-1">{option.text}</span>
            {option.checked === true ? (
              <Check aria-hidden="true" size={16} />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
