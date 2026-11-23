import { useAppHeaderRef } from "@fungi.computer/caps/components/app-header";
import type { ReactNode } from "react";

/** The retained desktop menu strip; each host supplies its own navigation. */
export function ShellMenuBar({ children }: Readonly<{ children: ReactNode }>) {
  const headerRef = useAppHeaderRef();
  return (
    <header
      className="tourtois-desktop-menu"
      aria-label="Application menu bar"
      ref={headerRef}
    >
      {children}
    </header>
  );
}
