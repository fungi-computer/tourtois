/** Durable facet for Tourtois layout methods; storage remains with its host owner. */
import { DurableObject } from "cloudflare:workers";
import { appBackend } from "./methods.js";
import type { LayoutContext } from "./layout.js";
class TourtoisFacet extends DurableObject<LayoutContext["env"]> {
  declare public readonly env: LayoutContext["env"];
}
export const Tourtois = appBackend.implement(TourtoisFacet);
