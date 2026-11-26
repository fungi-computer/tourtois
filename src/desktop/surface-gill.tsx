import { useEffect, useRef, useState } from "react";
import type { AppGillDesktopSize } from "@fungi.computer/gills";
import { ResultState } from "@fungi.computer/caps/blocks/result-state";
import { Button } from "@fungi.computer/caps/components/button";
import { Card } from "@fungi.computer/caps/components/card";

/** The placed surface tile whose App frame the host mounts. */
export type SurfaceTarget = Readonly<{
  itemId: string;
  surfaceId: string;
  gillId: string;
}>;
/** A live App frame in a tile; disposing it releases the frame. */
export type SurfaceHandle = Readonly<{ dispose: () => void | Promise<void> }>;
/**
 * Mount the App's own frame inside `container`, with the same authority as its
 * window. Abort only while the mount is pending; afterwards call `dispose`.
 */
export type SurfaceMount = (
  container: HTMLElement,
  target: SurfaceTarget,
  signal: AbortSignal,
  /**
   * Called when the person uses the App inside the frame. The frame is
   * sandboxed, so its clicks and keys never reach this document; the App's own
   * focus report is the signal to forward.
   */
  onUse: () => void,
) => Promise<SurfaceHandle>;

/**
 * A surface Gill: the App renders itself, its own header included, in a plain
 * card, so the host adds no second title bar. While arranging, a shield covers
 * the frame so a drag over it never reaches the App's document.
 */
export function SurfaceGill({
  title,
  appName,
  size,
  target,
  releaseId,
  mount,
  editing,
}: {
  title: string;
  appName: string;
  size: AppGillDesktopSize;
  target: SurfaceTarget;
  /**
   * The App Release the Team's directory names now. An unused or failed widget
   * moves to it at once; a widget the person has used offers an Update row
   * instead, so what they typed or scrolled is never thrown away.
   */
  releaseId: string | null;
  mount: SurfaceMount;
  editing: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const latest = useRef(mount);
  latest.current = mount;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { itemId, surfaceId, gillId } = target;
  // The release the live frame was mounted with. A newer one swaps in at once
  // only when that loses nothing: the widget failed, or the person never used
  // it. Otherwise it waits for the person's own Update, as App windows do, for
  // a draft or a half-filled form stays in the frame whatever has focus.
  const [mountedRelease, setMountedRelease] = useState(releaseId);
  const [touched, setTouched] = useState(false);
  const newer = releaseId !== mountedRelease;
  useEffect(() => {
    if (newer && (failed || !touched)) setMountedRelease(releaseId);
  }, [newer, failed, touched, releaseId]);
  useEffect(() => {
    // A click or key inside the sandboxed frame never reaches this document,
    // but it moves focus into the frame: the window blurs and the frame becomes
    // the active element. Look one task later, once focus has settled.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const node = slot.current;
        if (node?.contains(document.activeElement)) setTouched(true);
      }, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  useEffect(() => {
    const node = slot.current;
    if (!node) return;
    setFailed(false);
    setTouched(false);
    const abort = new AbortController();
    let handle: SurfaceHandle | undefined;
    latest
      .current(node, { itemId, surfaceId, gillId }, abort.signal, () => {
        setTouched(true);
      })
      .then(
        (mounted) => {
          handle = mounted;
          if (abort.signal.aborted) void release(mounted);
        },
        (cause: unknown) => {
          if (abort.signal.aborted) return;
          console.error("Surface Gill could not be mounted", cause);
          setFailed(true);
        },
      );
    return () => {
      if (handle) void release(handle);
      else abort.abort();
      handle = undefined;
    };
  }, [itemId, surfaceId, gillId, mountedRelease, attempt]);
  return (
    <Card
      aria-label={`${title}, ${appName}`}
      className="tourtois-surface-card"
      data-gill-size={size}
      role="region"
    >
      <div className="tourtois-surface-body">
        <div ref={slot} className="tourtois-surface-frame" />
        {failed ? (
          <div className="tourtois-surface-failure">
            <ResultState
              tone="failed"
              headingLevel={3}
              title="This widget could not open"
              description={`${appName} didn't start in its tile.`}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAttempt((count) => count + 1);
                  }}
                >
                  Try again
                </Button>
              }
            />
          </div>
        ) : null}
        {newer && !failed ? (
          <div className="tourtois-surface-update" role="status">
            <span>A newer version is ready.</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMountedRelease(releaseId);
              }}
            >
              Update
            </Button>
          </div>
        ) : null}
        {editing ? (
          <div data-surface-shield="" className="tourtois-surface-shield" />
        ) : null}
      </div>
    </Card>
  );
}

async function release(handle: SurfaceHandle): Promise<void> {
  try {
    await handle.dispose();
  } catch (cause) {
    console.error("Surface Gill could not be released", cause);
  }
}
