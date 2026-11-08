import { AppBar, type AppBarProps } from "@fungi.computer/caps/blocks/app-bar";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@fungi.computer/caps/components/dropdown-menu";
import { useLayer } from "@fungi.computer/maosaico";
import { Check, PanelsTopLeft } from "lucide-react";

/** Disclosure only; the supplied callbacks retain window lifecycle ownership. */
export function WorkbenchAppBar({
  phone,
  ...props
}: AppBarProps & { phone: boolean }) {
  const popover = useLayer("popover");
  const collapsed = phone && props.windows.length > 0;
  return (
    <>
      {collapsed ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={<Button size="menubar" variant="ghost" />}
            aria-label="Switch open Apps"
            title="Switch open Apps"
          >
            <span
              aria-hidden="true"
              className="grid size-5 place-items-center [&_svg]:size-full"
            >
              {props.windows.find((item) => item.active)?.icon ?? (
                <PanelsTopLeft />
              )}
            </span>
            <span className="tourtois-windows-label">Windows</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent container={popover} align="start">
            {props.windows.map((item) => (
              <DropdownMenuItem
                key={item.id}
                role="menuitemradio"
                aria-checked={item.active ?? false}
                aria-current={item.active ? "page" : undefined}
                onSelect={item.onSelect}
              >
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center [&_svg]:size-5"
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.active ? <Check aria-hidden="true" size={16} /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {props.windows.map((item) =>
              item.onClose ? (
                <DropdownMenuItem key={item.id} onSelect={item.onClose}>
                  Close {item.label}
                </DropdownMenuItem>
              ) : null,
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <AppBar
        appsLabel="Team Apps"
        {...props}
        windows={collapsed ? [] : props.windows}
      />
    </>
  );
}
