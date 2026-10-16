import { createContext, useContext, useEffect, useRef } from "react";

export type SettingsLeaveState = "clean" | "dirty" | "pending" | "uncertain";
export type SettingsLeaveGuard = () => SettingsLeaveState;

/** Registers readers, not copies of form or request state. */
export const SettingsLeaveContext = createContext<
  (guard: SettingsLeaveGuard) => () => void
>(() => () => undefined);

export function useSettingsLeaveGuard(read: SettingsLeaveGuard) {
  const register = useContext(SettingsLeaveContext);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => register(() => latest.current()), [register]);
}
