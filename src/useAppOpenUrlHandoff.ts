import type { AppOpenInput } from "@fungi.computer/agar/apps";
import { useEffect, useRef } from "react";
import {
  appOpenInputFromUrl,
  cleanInvalidAppOpenUrlSearch,
  withoutAppOpenUrlSearch,
} from "./app-open-url.js";
import type { TourtoisAppSurfaceHost } from "./app-surface.js";

/** Consume the host or browser address once, after the App directory is ready. */
export function useAppOpenUrlHandoff({
  teamId,
  host,
  ready,
  takeAppOpenRequest,
  onOpen,
  setError,
}: {
  teamId: string;
  host: TourtoisAppSurfaceHost | null;
  ready: boolean;
  takeAppOpenRequest: (() => Promise<AppOpenInput | null>) | undefined;
  onOpen: (input: AppOpenInput) => Promise<void>;
  setError: (error: Error) => void;
}) {
  const handledAppOpenUrl = useRef<string | null>(null);
  const handlers = useRef({ onOpen, setError });
  handlers.current = { onOpen, setError };
  const takeAppOpenRequestRef = useRef(takeAppOpenRequest);
  useEffect(() => {
    const take = takeAppOpenRequestRef.current;
    if (!take || !host || !ready) return;
    // An isolated dashboard's own address never carries the handoff; its host
    // hands over the one from the visitor's address, exactly once.
    takeAppOpenRequestRef.current = undefined;
    void (async () => {
      try {
        const input = await take();
        if (input) await handlers.current.onOpen(input);
      } catch (error) {
        const { setError } = handlers.current;
        setError(
          error instanceof Error
            ? error
            : new Error("This App could not open.", { cause: error }),
        );
      }
    })();
  }, [host, ready]);

  useEffect(() => {
    if (takeAppOpenRequest) return;
    const current = window.location.search;
    const cleaned = cleanInvalidAppOpenUrlSearch(current);
    if (cleaned !== current) {
      const destination = new URL(window.location.href);
      destination.search = cleaned;
      window.history.replaceState(window.history.state, "", destination);
      return;
    }
    if (!host || !ready || !current) return;
    const input = appOpenInputFromUrl(current);
    if (!input || handledAppOpenUrl.current === current) return;
    handledAppOpenUrl.current = current;
    const destination = new URL(window.location.href);
    destination.search = withoutAppOpenUrlSearch(current);
    window.history.replaceState(window.history.state, "", destination);
    void (async () => {
      try {
        await handlers.current.onOpen(input);
      } catch (error) {
        const { setError } = handlers.current;
        setError(
          error instanceof Error
            ? error
            : new Error("This App could not open.", { cause: error }),
        );
      }
    })();
  }, [host, ready, teamId]);
}
