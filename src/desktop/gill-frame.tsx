import { useLayoutEffect, useRef, type ReactNode } from "react";
import { SectionCard } from "@fungi.computer/caps/blocks/section-card";
import type { AppGillDesktopSize } from "@fungi.computer/gills";

/** Host-owned presentation; content, edit gestures and size selection stay with the caller. */
export function GillFrame({
  title,
  appHeader,
  size,
  editHandle,
  children,
  onContentHeight,
}: {
  title: string;
  appHeader?: Readonly<{ name: string; icon: ReactNode }> | undefined;
  size: AppGillDesktopSize;
  editHandle?: ReactNode;
  children: ReactNode;
  onContentHeight?: ((height: number) => void) | undefined;
}) {
  const card = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const report = useRef(onContentHeight);
  report.current = onContentHeight;
  const measuring = onContentHeight !== undefined;
  useLayoutEffect(() => {
    if (!measuring) return;
    const root = card.current;
    const body = content.current;
    const header = root?.firstElementChild;
    const section = body?.parentElement?.parentElement;
    if (!root || !body || !header || !section) return;
    const measure = () => {
      const rootStyle = getComputedStyle(root);
      const sectionStyle = getComputedStyle(section);
      const height =
        header.getBoundingClientRect().height +
        body.getBoundingClientRect().height +
        parseFloat(sectionStyle.paddingTop) +
        parseFloat(sectionStyle.paddingBottom) +
        parseFloat(rootStyle.borderTopWidth) +
        parseFloat(rootStyle.borderBottomWidth);
      if (Number.isFinite(height) && height > 0)
        report.current?.(Math.ceil(height));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    observer.observe(header);
    measure();
    return () => {
      observer.disconnect();
    };
  }, [measuring]);
  const scroller = useRef<HTMLDivElement>(null);
  // A bounded Gill scrolls its rows. At rest its body ends on a row boundary,
  // so the last visible row is whole and the rest wait below the scroll.
  useLayoutEffect(() => {
    const root = card.current;
    const viewport = scroller.current;
    const body = content.current;
    const header = root?.firstElementChild;
    const section = body?.parentElement?.parentElement;
    if (!root || !viewport || !body || !header || !section) return;
    const fit = () => {
      const sectionStyle = getComputedStyle(section);
      // The room the card leaves for its body, read from the card so a
      // limit set here never feeds back into it.
      const room =
        root.clientHeight -
        header.getBoundingClientRect().height -
        parseFloat(sectionStyle.paddingTop) -
        parseFloat(sectionStyle.paddingBottom);
      const top = body.getBoundingClientRect().top;
      // A row is cut when the body ends inside its content; losing only its
      // bottom padding leaves the row whole.
      const cut = [...body.querySelectorAll(".list-row")]
        .map((row) => {
          const box = row.getBoundingClientRect();
          return {
            top: box.top - top,
            content:
              box.bottom -
              top -
              parseFloat(getComputedStyle(row).paddingBottom),
          };
        })
        .find((row) => row.top < room && row.content > room + 0.5);
      viewport.style.maxHeight = cut ? `${String(Math.floor(cut.top))}px` : "";
    };
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    observer.observe(header);
    observer.observe(body);
    fit();
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <SectionCard
      ref={card}
      className="tourtois-gill-frame"
      heading={
        appHeader ? (
          <span className="flex min-w-0 items-center gap-sm">
            <span className="tourtois-gill-frame-icon">{appHeader.icon}</span>
            <span className="truncate">{appHeader.name}</span>
          </span>
        ) : (
          title
        )
      }
      description={appHeader ? title : undefined}
      data-gill-size={size}
      actions={editHandle}
    >
      <div ref={scroller} className="tourtois-gill-body">
        <div ref={content} className="tourtois-gill-content">
          {children}
        </div>
      </div>
    </SectionCard>
  );
}
