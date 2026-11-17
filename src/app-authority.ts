import * as z from "zod";
import {
  appAuthorityEnforcementSchema,
  type AppAddress,
} from "@fungi.computer/nacre/app-directory";

/**
 * One owner save of an App's grants: the changes Oyster reduced from the
 * owner's edit and the digests the owner read them against. The host rejects
 * a save whose Release artifact or declared operations have since changed.
 */
export type AppGrantsSave<Change extends object> = Readonly<{
  changes: readonly Change[];
  artifactDigest: string;
  declaredOperationsDigest: string;
}>;

export function appGrantsMutationRequest<Change extends object>(
  teamId: string,
  requestId: string,
  address: AppAddress,
  expectedAuthorityVersion: number,
  save: AppGrantsSave<Change>,
) {
  return {
    url: "/api/teams/" + encodeURIComponent(teamId) + "/apps",
    init: {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Origin: window.location.origin,
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({
        target: address,
        expectedVersion: expectedAuthorityVersion,
        command: {
          kind: "set-grants",
          changes: save.changes,
          artifactDigest: save.artifactDigest,
          declaredOperationsDigest: save.declaredOperationsDigest,
        },
      }),
    } satisfies RequestInit,
  };
}

export type AppMutationRequest = ReturnType<typeof appGrantsMutationRequest>;

export const appMutationResponseSchema = z.strictObject({
  kind: z.literal("accepted"),
  receipt: z.unknown(),
  enforcement: appAuthorityEnforcementSchema.nullable(),
});
