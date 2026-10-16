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
  return (
    <SectionCard
      ref={card}
      className="tourtois-gill-frame"
      heading={
        appHeader ? (
          <span className="flex min-w-0 items-center gap-sm">
            <span className="inline-flex size-5 shrink-0 [&_:is(svg,.caps-monogram)]:size-5">
              {appHeader.icon}
            </span>
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
      <div className="tourtois-gill-body">
        <div ref={content} className="tourtois-gill-content">
          {children}
        </div>
      </div>
    </SectionCard>
  );
}
