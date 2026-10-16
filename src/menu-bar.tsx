import type { ReactNode } from "react";

/** The retained desktop menu strip; each host supplies its own navigation. */
export function ShellMenuBar({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <header className="tourtois-desktop-menu" aria-label="Application menu bar">
      {children}
    </header>
  );
}
