import { ShellMenuBar } from "./menu-bar.js";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Home } from "lucide-react";
import { Button } from "@fungi.computer/caps/components/button";
import { useLayer } from "@fungi.computer/maosaico";
import { useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@fungi.computer/caps/components/dropdown-menu";
import { FocusedAppMenus } from "./FocusedAppMenus.js";
import { MushroomMark } from "./MushroomMark.js";

/** Presentation only: window state and command ownership stay with their owners. */
export function DesktopMenuBar({
  teamName,
  focusedId,
  title,
  appBar,
  tiled,
  onLayoutChange,
  onRestoreLayout,
  onArrangeDesktop,
  focusedControls,
  onOpenSettings,
  onEditAvatar,
  systemMenuItems,
  onShowDesktop,
}: {
  teamName: string;
  focusedId: string | null;
  title: string;
  appBar: ReactNode;
  tiled: boolean;
  onLayoutChange?: ((tiled: boolean) => void) | undefined;
  onRestoreLayout?: (() => void) | undefined;
  /** Opens the desktop's own arrange mode, a Layout-menu command. */
  onArrangeDesktop?: (() => void) | undefined;
  focusedControls?: ReactNode;
  onOpenSettings: () => void;
  onEditAvatar: () => void;
  systemMenuItems?: ReactNode;
  onShowDesktop?: (() => void) | undefined;
}) {
  const popover = useLayer("popover");
  const [systemOpen, setSystemOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  return (
    <ShellMenuBar>
      <DropdownMenu
        modal={false}
        open={systemOpen}
        onOpenChange={setSystemOpen}
      >
        <DropdownMenuTrigger
          className="tourtois-system-menu-trigger"
          render={<Button size="menubar" variant="ghost" />}
          aria-label="Team and account menu"
          aria-description={"Current Team: " + teamName}
          title={teamName}
        >
          <MushroomMark />
          <span className="tourtois-team-name truncate">{teamName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          container={popover}
          // A sibling App click keeps focus there; Escape still returns here.
          finalFocus={(interaction) =>
            interaction === "keyboard" && document.hasFocus()
          }
        >
          <DropdownMenuItem onSelect={onOpenSettings}>
            System Settings…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEditAvatar}>
            Edit avatar…
          </DropdownMenuItem>
          {systemMenuItems}
        </DropdownMenuContent>
      </DropdownMenu>
      {appBar}
      {onShowDesktop ? (
        <IconButton
          size="responsive"
          icon={<Home />}
          aria-label="Show desktop"
          title="Show desktop"
          onClick={onShowDesktop}
        />
      ) : null}
      <strong className="tourtois-focused-app">{title}</strong>
      <FocusedAppMenus key={`menus:${focusedId ?? "shell"}`} />
      {onLayoutChange || onRestoreLayout || onArrangeDesktop ? (
        <DropdownMenu
          key={`window:${focusedId ?? "shell"}`}
          modal={false}
          open={layoutOpen}
          onOpenChange={setLayoutOpen}
        >
          <DropdownMenuTrigger
            render={<Button size="menubar" variant="ghost" />}
          >
            Layout
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            container={popover}
            finalFocus={(interaction) =>
              interaction === "keyboard" && document.hasFocus()
            }
          >
            {onLayoutChange ? (
              <>
                <DropdownMenuCheckboxItem
                  checked={tiled}
                  onCheckedChange={() => {
                    onLayoutChange(true);
                  }}
                >
                  Tiled
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={!tiled}
                  onCheckedChange={() => {
                    onLayoutChange(false);
                  }}
                >
                  Floating
                </DropdownMenuCheckboxItem>
              </>
            ) : null}
            {onRestoreLayout ? (
              <DropdownMenuItem onSelect={onRestoreLayout}>
                Restore layout
              </DropdownMenuItem>
            ) : null}
            {onArrangeDesktop ? (
              <DropdownMenuItem onSelect={onArrangeDesktop}>
                Arrange desktop
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {focusedControls}
    </ShellMenuBar>
  );
}
