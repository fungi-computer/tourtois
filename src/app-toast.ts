import type { ToastInput } from "@fungi.computer/agar";
import { showNotice } from "@fungi.computer/caps/components/toaster";

/** The one Toaster mount an App's notice reaches in the Tourtois shell. */
export const WORKBENCH_NOTICES = "workbench-notices";

/**
 * A failed change as one sentence: what failed, then the host's own reason.
 * Host ports throw an Error whose message is that reason; Hub's client names
 * the HTTP cause when a refusal's body names none.
 */
export function failureNotice(summary: string, cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? `${summary}: ${cause.message}`
    : `${summary}.`;
}

export function showAppToast(notice: ToastInput): void {
  showNotice(notice, WORKBENCH_NOTICES);
}
