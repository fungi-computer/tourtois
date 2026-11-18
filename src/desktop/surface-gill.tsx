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
  mount,
  editing,
}: {
  title: string;
  appName: string;
  size: AppGillDesktopSize;
  target: SurfaceTarget;
  mount: SurfaceMount;
  editing: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const latest = useRef(mount);
  latest.current = mount;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { itemId, surfaceId, gillId } = target;
  useEffect(() => {
    const node = slot.current;
    if (!node) return;
    setFailed(false);
    const abort = new AbortController();
    let handle: SurfaceHandle | undefined;
    latest.current(node, { itemId, surfaceId, gillId }, abort.signal).then(
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
  }, [itemId, surfaceId, gillId, attempt]);
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
