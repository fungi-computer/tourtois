import type { MaosaicoItemBinding } from "@fungi.computer/maosaico";
import { animate } from "animejs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Animate layout changes, but track pointer gestures and reduced motion directly. */
export function useWindowMotion(
  binding: MaosaicoItemBinding,
  interacting: boolean,
) {
  const element = useRef<HTMLElement>(null);
  const placed = useRef(false);
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
  useLayoutEffect(() => {
    if (!element.current || !binding.visible) return;
    const motion = animate(element.current, {
      x,
      y,
      width,
      height,
      duration: !placed.current || interacting || reduced ? 0 : 200,
      ease: "outQuad",
    });
    placed.current = true;
    return () => {
      motion.cancel();
    };
  }, [x, y, width, height, binding.visible, interacting, reduced]);
  return element;
}
