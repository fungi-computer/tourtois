import { AppError } from "@fungi.computer/agar";
import {
  desktopGillAdditionSchema,
  desktopGillSelectionSchema,
  type DesktopGillSelection,
  type WorkbenchDesktopSettings,
} from "@fungi.computer/oyster/shell/workbench";
import type { DesktopLayoutClient } from "../desktop-client.js";
import type { DesktopArrangeResult } from "../desktop-layout.js";

/** Only the host's member-consent UI invokes this admitted dashboard callback. */
export function desktopSettingsHandler(
  current: () => DesktopLayoutClient | null,
): WorkbenchDesktopSettings {
  const owner = () => {
    const value = current();
    if (!value)
      throw new AppError("Your desktop is still loading. Try again.", {
        code: "HOST_FAILURE",
        retryable: true,
      });
    return value;
  };
  const matching = (
    value: DesktopLayoutClient,
    request: DesktopGillSelection,
  ) =>
    value
      .get()
      .layout.items.filter(
        (item) =>
          item.surfaceId === request.surfaceId &&
          item.gillId === request.gillId,
      );
  const confirmed = (result: DesktopArrangeResult) => {
    if (result.kind === "rejected")
      throw new AppError(
        result.code === "conflict"
          ? "Your desktop changed elsewhere. Try again."
          : result.code === "too_many"
            ? "Your desktop is full. Remove a widget before adding another."
            : "This widget cannot be changed on your desktop. Check its availability and try again.",
        { code: "INVALID_ARGUMENT", retryable: result.code === "conflict" },
      );
  };
  return {
    readGill: (input) => {
      const request = desktopGillSelectionSchema.parse(input);
      return Promise.resolve(
        matching(owner(), request).map((item) => item.size),
      );
    },
    async addGill(input) {
      const request = desktopGillAdditionSchema.parse(input);
      const value = owner();
      if (matching(value, request).length)
        throw new AppError("This widget is already on your desktop.", {
          code: "INVALID_ARGUMENT",
          retryable: false,
        });
      confirmed(
        await value.mutate("layout.place", {
          scope: "member",
          basedOn: value.get().memberRevision,
          ...request,
        }),
      );
      // The method commits through the host storage owner and refreshes layout.get.
    },
    async removeGill(input) {
      const request = desktopGillSelectionSchema.parse(input);
      const value = owner();
      const items = matching(value, request);
      if (!items.length) return;
      confirmed(
        await value.mutate("layout.set", {
          scope: "member",
          basedOn: value.get().memberRevision,
          layout: {
            ...value.get().layout,
            items: value
              .get()
              .layout.items.filter(
                (item) => !items.some((selected) => selected.id === item.id),
              ),
          },
        }),
      );
    },
  };
}
