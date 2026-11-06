import type { Bounds, MaosaicoItemBinding } from "@fungi.computer/maosaico";
import { animate } from "animejs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Animate rearrangements; follow workspace resizing, gestures and reduced motion directly. */
export function useWindowMotion(
  binding: MaosaicoItemBinding,
  interacting: boolean,
  bounds: Bounds,
) {
  const element = useRef<HTMLElement>(null);
  const placed = useRef(false);
  const parentSize = useRef({ width: 0, height: 0 });
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReduced(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  const { x, y, width, height } = binding.frame;
  const { width: workspaceWidth, height: workspaceHeight } = bounds;
  useLayoutEffect(() => {
    if (!element.current || !binding.visible) return;
    const size = { width: workspaceWidth, height: workspaceHeight };
    const resized =
      size.width !== parentSize.current.width ||
      size.height !== parentSize.current.height;
    parentSize.current = size;
    const motion = animate(element.current, {
      x,
      y,
      width,
      height,
      duration: !placed.current || interacting || reduced || resized ? 0 : 200,
      ease: "outQuad",
    });
    placed.current = true;
    return () => {
      motion.cancel();
    };
  }, [
    x,
    y,
    width,
    height,
    binding.visible,
    interacting,
    reduced,
    workspaceWidth,
    workspaceHeight,
  ]);
  return element;
}
