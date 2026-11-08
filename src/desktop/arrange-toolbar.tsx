import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@fungi.computer/caps/components/button";
import { ConfirmAction } from "@fungi.computer/caps/components/confirm-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { PopoverAnchor } from "@fungi.computer/caps/components/popover";
import { Status } from "@fungi.computer/caps/components/status";
import { Surface } from "@fungi.computer/caps/components/surface";
import { useLayer } from "@fungi.computer/maosaico";
import { WidgetPicker, type WidgetChoice } from "./widget-picker.js";
import type { DesktopGill } from "../desktop-layout.js";

export type ArrangeStatus = "idle" | "saving" | "saved";

/** Return focus to where Arrange was invoked, or the Layout menu. */
function restoreFocus(origin: Element | null): void {
  if (origin instanceof HTMLElement && origin.isConnected) {
    origin.focus();
    return;
  }
  const layout = document.querySelector<HTMLElement>("[data-layout-menu]");
  layout?.focus();
}

/**
 * Arrange's floating controls. They live in the chrome layer, take no flow
 * space, and stay above every window.
 */
export function ArrangeToolbar({
  phone,
  status,
  error,
  canWriteTeam,
  choices,
  saving,
  onChoose,
  onReset,
  onSaveTeam,
  onDone,
}: {
  phone: boolean;
  status: ArrangeStatus;
  error: string | null;
  canWriteTeam: boolean;
  choices: readonly WidgetChoice[];
  saving: boolean;
  onChoose: (gill: DesktopGill) => void;
  onReset: () => Promise<void>;
  onSaveTeam: () => void;
  onDone: () => void;
}) {
  const chrome = useLayer("chrome");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const origin = useRef<Element | null>(document.activeElement);
  const done = useRef(onDone);
  done.current = onDone;
  const picker = useRef(pickerOpen);
  picker.current = pickerOpen;
  useEffect(() => {
    const back = origin.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (picker.current) setPickerOpen(false);
      else done.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocus(back);
    };
  }, []);
  if (!chrome) return null;
  return createPortal(
    <Surface
      className="tourtois-arrange"
      role="toolbar"
      aria-label="Arranging desktop"
      data-phone={phone ? "" : undefined}
    >
      <PopoverAnchor className="tourtois-arrange-add">
        {pickerOpen ? (
          <WidgetPicker
            choices={choices}
            disabled={saving}
            onChoose={onChoose}
          />
        ) : null}
        <Button
          size="sm"
          variant="outline"
          aria-expanded={pickerOpen}
          aria-label="Add widget"
          onClick={() => {
            setPickerOpen(!pickerOpen);
          }}
        >
          <Plus aria-hidden="true" size={16} />
          {phone ? "Add" : "Add widget"}
        </Button>
      </PopoverAnchor>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <IconButton
              size="sm"
              variant="ghost"
              icon={<MoreHorizontal />}
              aria-label="More layout actions"
              title="More layout actions"
            />
          }
        />
        <DropdownMenuContent container={chrome} align="end" side="top">
          <DropdownMenuItem
            onSelect={() => {
              setResetOpen(true);
            }}
          >
            Reset layout…
          </DropdownMenuItem>
          {canWriteTeam ? (
            <DropdownMenuItem onSelect={onSaveTeam}>
              Save as Team default
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        className="tourtois-arrange-state"
        role="status"
        data-empty={error || status !== "idle" ? undefined : ""}
      >
        {error ? (
          <Status glyph="cross" tone="error" label={error} />
        ) : status === "saving" ? (
          <Status glyph="arc" tone="info" label="Saving…" />
        ) : status === "saved" ? (
          <Status glyph="check" tone="success" label="Saved" />
        ) : null}
      </span>
      <Button
        size="sm"
        variant="primary"
        aria-label="Done arranging"
        onClick={onDone}
      >
        Done
      </Button>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset layout</DialogTitle>
            <DialogDescription>
              Your widgets go back to the default desktop.
            </DialogDescription>
          </DialogHeader>
          <ConfirmAction
            mode="hold"
            label="Reset layout"
            confirmLabel="Hold to reset the layout"
            onConfirm={async () => {
              await onReset();
              setResetOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Surface>,
    chrome,
  );
}
