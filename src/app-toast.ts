import type { ToastInput } from "@fungi.computer/agar";
import { showNotice } from "@fungi.computer/caps/components/toaster";

/** The one Toaster mount an App's notice reaches in the Tourtois shell. */
export const WORKBENCH_NOTICES = "workbench-notices";

export function showAppToast(notice: ToastInput): void {
  showNotice(notice, WORKBENCH_NOTICES);
}
