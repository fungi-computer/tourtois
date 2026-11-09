// What this Oyster host knows about its own setup, published to every App.
import type { AppSetup, SetupNeed, SetupOutcome } from "@fungi.computer/agar";
import type { WorkbenchSetupPort } from "@fungi.computer/nacre/workbench";
import { z } from "zod";
import type { SettingsLocation } from "./settings-routes.js";

const state = z.enum(["ready", "missing", "unknown"]);
/** The owner-direct `/api/setup` reply, decoded before any App sees it. */
export const oysterSetupSchema = z.strictObject({
  models: state,
  media: state,
  git: state,
  terminal: z.enum(["ready", "exec-only", "missing", "unknown"]),
});

/** Where each need is fixed in this host's Settings. */
export function settingsForNeed(need: SetupNeed): SettingsLocation {
  // Model keys and image setup have separate destinations; runtimes live in Computers.
  return need === "model" || need === "media"
    ? { category: "keys", target: need }
    : { category: "computers" };
}

export type OysterSetupDeps = Readonly<{
  /** The host facts, already decoded with `oysterSetupSchema`. */
  readFacts(): Promise<AppSetup>;
  openSettings(location: SettingsLocation): void;
  /** Settings closing is when a freshly added key becomes visible. */
  subscribeSettingsClosed(listener: () => void): () => void;
}>;

/** The setup port: facts read live, plus the Settings page for each need. */
export function createOysterSetupPort(
  deps: OysterSetupDeps,
): WorkbenchSetupPort & Readonly<{ changed(): void }> {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  deps.subscribeSettingsClosed(changed);
  return {
    read: () => deps.readFacts(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: (need): Promise<SetupOutcome> => {
      deps.openSettings(settingsForNeed(need));
      return Promise.resolve("opened");
    },
    changed,
  };
}
