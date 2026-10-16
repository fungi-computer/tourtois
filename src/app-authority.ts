import * as z from "zod";
import {
  appAuthorityEnforcementSchema,
  type AppAddress,
  appComputerPermissionSchema,
  appAgentPermissionSchema,
  appGenerationPermissionsSchema,
  appMarketplacePermissionsSchema,
} from "@fungi.computer/oyster/shell/app-directory";

export const appPermissionChangesSchema = z
  .strictObject({
    computer: appComputerPermissionSchema.optional(),
    agents: appAgentPermissionSchema.optional(),
    generation: appGenerationPermissionsSchema.optional(),
    marketplace: appMarketplacePermissionsSchema.optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    "At least one permission section must change",
  );
export type AppPermissionChanges = z.output<typeof appPermissionChangesSchema>;
export const appPermissionReceiptSchema = z.object({
  authorityVersion: z.number().int().positive(),
  computerPermission: appComputerPermissionSchema.nullable(),
  agentPermission: appAgentPermissionSchema,
  generationPermissions: appGenerationPermissionsSchema,
  marketplacePermissions: appMarketplacePermissionsSchema,
});

export function appPermissionsMutationRequest(
  teamId: string,
  requestId: string,
  address: AppAddress,
  expectedAuthorityVersion: number,
  permissions: AppPermissionChanges,
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
        command: { kind: "set-permissions", permissions },
      }),
    } satisfies RequestInit,
  };
}

export type AppMutationRequest = ReturnType<
  typeof appPermissionsMutationRequest
>;

export const appMutationResponseSchema = z.strictObject({
  kind: z.literal("accepted"),
  receipt: z.unknown(),
  enforcement: appAuthorityEnforcementSchema.nullable(),
});
