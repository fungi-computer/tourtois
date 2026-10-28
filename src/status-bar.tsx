import { forwardRef, type ReactNode } from "react";
import { AppStatusItem } from "@fungi.computer/caps/blocks/app-status-bar";
import {
  Button,
  type ButtonProps,
} from "@fungi.computer/caps/components/button";
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

/**
 * The one control every App status action draws with: a flat chip beside
 * the Computer picker, never a raised key. Caps' status-bar chip replaces
 * this composition when it ships.
 */
const StatusBarButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "children" | "size" | "variant"> & {
    label: string;
    icon?: ReactNode;
    count?: ReactNode;
    /** A status light before the label. */
    light?: ReactNode;
    pressed?: boolean;
    expanded?: boolean;
  }
>(function StatusBarButton(
  { label, icon, count, light, pressed, expanded, ...props },
  ref,
) {
  return (
    <Button
      {...props}
      ref={ref}
      variant="ghost"
      size="xs"
      className="caps-status-bar-picker tourtois-status-chip"
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
    >
      {icon}
      {light}
      <span className="caps-status-bar-picker-label tourtois-status-chip-label">
        {label}
      </span>
      {count}
    </Button>
  );
});

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
        <StatusBarButton
          label={item.text}
          icon={item.icon === undefined ? undefined : statusIcons[item.icon]}
          count={count}
          light={light}
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
        <StatusBarButton
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
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <StatusBarButton
                label={item.text}
                count={count}
                title={item.title}
              />
            }
          />
          <DropdownMenuContent container={container} align="start">
            {item.options.map((option) => (
              <DropdownMenuItem
                key={option.id}
                disabled={option.disabled}
                {...(option.checked === undefined
                  ? {}
                  : { role: "menuitemradio", "aria-checked": option.checked })}
                onSelect={() => {
                  onAction({ itemId: item.id, optionId: option.id });
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
}
