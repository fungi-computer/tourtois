/** The desktop stays mounted; layout determines whether it can receive input. */
export type DesktopVisibility = "revealed" | "partial" | "covered";

export function desktopVisibility({
  hasVisibleWindows,
  mode,
  zoomedId,
  phone,
}: {
  hasVisibleWindows: boolean;
  mode: "tiled" | "floating";
  zoomedId: string | null;
  phone: boolean;
}): DesktopVisibility {
  if (!hasVisibleWindows) return "revealed";
  return mode === "tiled" || zoomedId !== null || phone ? "covered" : "partial";
}
