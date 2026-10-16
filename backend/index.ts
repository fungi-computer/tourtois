/** Durable facet for Tourtois layout methods; storage remains with its host owner. */
import { DurableObject } from "cloudflare:workers";
import * as z from "zod";
import {
  appBackendActorHeader,
  appBackendComputerHeader,
} from "@fungi.computer/agar/backend";
import { appBackend } from "./methods.js";
import type { LayoutContext } from "./layout.js";
const requestSchema = z.strictObject({
  method: z.string().min(1).max(80),
  input: z.json(),
});
class TourtoisFacet extends DurableObject<LayoutContext["env"]> {
  declare public readonly env: LayoutContext["env"];
  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "PUT")
      return new Response(null, { status: 405, headers: { Allow: "PUT" } });
    const memberId = request.headers.get(appBackendActorHeader);
    if (memberId === null)
      return Response.json({ error: "App actor unavailable" }, { status: 403 });
    try {
      const input = requestSchema.parse(await request.json());
      if (!Object.hasOwn(appBackend.methods, input.method))
        return Response.json({ error: "No such method" }, { status: 404 });
      return Response.json(
        await appBackend.call(input.method, input.input, this, {
          actor: { kind: "member", memberId },
          computerId: request.headers.get(appBackendComputerHeader),
        }),
      );
    } catch (cause) {
      return Response.json(
        { error: "Tourtois could not complete this layout request" },
        { status: cause instanceof z.ZodError ? 400 : 500 },
      );
    }
  }
}
export const Tourtois = appBackend.implement(TourtoisFacet);
