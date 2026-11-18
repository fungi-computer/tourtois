import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppGillDesktopSize } from "@fungi.computer/gills";
import { ResultState } from "@fungi.computer/caps/blocks/result-state";
import { Button } from "@fungi.computer/caps/components/button";
import { GillFrame } from "./gill-frame.js";

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
 * A surface Gill: the App renders itself in its tile. While arranging, a shield
 * covers the frame so a drag over it never reaches the App's document.
 */
export function SurfaceGill({
  title,
  appHeader,
  size,
  target,
  mount,
  editing,
  editHandle,
}: {
  title: string;
  appHeader: Readonly<{ name: string; icon: ReactNode }>;
  size: AppGillDesktopSize;
  target: SurfaceTarget;
  mount: SurfaceMount;
  editing: boolean;
  editHandle?: ReactNode;
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
    <GillFrame
      title={title}
      appHeader={appHeader}
      size={size}
      editHandle={editHandle}
    >
      <div className="tourtois-surface-body">
        <div ref={slot} className="tourtois-surface-frame" />
        {failed ? (
          <div className="tourtois-surface-failure">
            <ResultState
              tone="failed"
              headingLevel={3}
              title="This widget could not open"
              description={`${appHeader.name} didn't start in its tile.`}
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
    </GillFrame>
  );
}

async function release(handle: SurfaceHandle): Promise<void> {
  try {
    await handle.dispose();
  } catch (cause) {
    console.error("Surface Gill could not be released", cause);
  }
}
