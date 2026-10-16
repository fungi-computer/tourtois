import {
  appOpenInputSchema,
  type AppOpenInput,
} from "@fungi.computer/agar/apps";
import * as Schema from "effect/Schema";

const handoffFields = ["open", "app", "intent", "text"] as const;
const handoffBaseFields: readonly string[] = handoffFields;

export type AppOpenUrlSearch = AppOpenInput;

/** URLSearchParams owns decoding; Agar owns the bounded intent grammar. */
export function appOpenUrlSearch(search: string): AppOpenUrlSearch | null {
  const parameters = new URLSearchParams(search);
  if (
    handoffFields.some((field) => parameters.getAll(field).length > 1) ||
    parameters.getAll("mode").length > 1
  )
    return null;
  if (parameters.has("open") === parameters.has("app")) return null;
  const targetKey = parameters.has("app") ? "app" : "open";
  const kind = parameters.get("intent");
  const required =
    kind === "compose"
      ? [targetKey, "intent", "text"]
      : kind === "navigate"
        ? [targetKey, "intent"]
        : [];
  if (required.length === 0 || required.some((field) => !parameters.has(field)))
    return null;
  let intent: AppOpenInput["intent"] | null = null;
  if (kind === "compose") intent = { kind, text: parameters.get("text") ?? "" };
  if (kind === "navigate") {
    const params = [...parameters.entries()]
      .filter(([key]) => !handoffBaseFields.includes(key) && key !== "mode")
      .map(([key, value]) => ({ key, value }));
    if (
      params.some(({ key }) => key.length > 64 || key.length === 0) ||
      new Set(params.map(({ key }) => key)).size !== params.length
    )
      return null;
    intent = { kind, params };
  }
  const candidate = parameters.has("app")
    ? { appId: parameters.get("app"), intent }
    : { role: parameters.get("open"), intent };
  return Schema.is(appOpenInputSchema)(candidate) ? candidate : null;
}

export function appOpenInputFromUrl(search: string): AppOpenInput | null {
  return appOpenUrlSearch(search);
}

/** Keep unrelated query fields while consuming or dropping a bad handoff. */
export function withoutAppOpenUrlSearch(search: string): string {
  const parameters = new URLSearchParams(search);
  const isNavigation = parameters.get("intent") === "navigate";
  for (const field of handoffFields) parameters.delete(field);
  if (isNavigation) {
    const remainingKeys = new Set(["mode"]);
    for (const key of Array.from(parameters.keys()))
      if (!remainingKeys.has(key)) parameters.delete(key);
  }
  const remaining = parameters.toString();
  return remaining ? `?${remaining}` : "";
}

export function cleanInvalidAppOpenUrlSearch(search: string): string {
  const parameters = new URLSearchParams(search);
  return handoffFields.some((field) => parameters.has(field)) &&
    appOpenUrlSearch(search) === null
    ? withoutAppOpenUrlSearch(search)
    : search;
}
