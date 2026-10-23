import {
  memberAvatarSchema,
  type MemberAvatar,
} from "@fungi.computer/sprite-zdog/avatar";
import * as z from "zod";
import { teamComputerDirectorySchema } from "@fungi.computer/nacre/workbench";
import type { SettingsSectionPorts } from "../src/settings-sections.js";
import {
  workbenchDirectorySchema,
  type WorkbenchDirectory,
} from "@fungi.computer/nacre/workbench-directory";

async function hostJson<T>(response: Response, schema: z.ZodType<T>) {
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return schema.parse(await response.json());
}

/**
 * The workbench host's account port over its mocked account routes. Hosted
 * Team sections (permissions, Connectors, Channels, Selling…) belong to Hub.
 */
export const workbenchPorts = {
  avatar: {
    read: async (signal) =>
      (
        await hostJson(
          await fetch("/api/account", { signal }),
          z.object({
            actor: z.object({ avatar: memberAvatarSchema }).nullable(),
          }),
        )
      ).actor?.avatar ?? null,
    save: async (next: MemberAvatar) =>
      hostJson(
        await fetch("/api/account/avatar", {
          method: "PUT",
          body: JSON.stringify(next),
        }),
        memberAvatarSchema,
      ),
  },
} satisfies SettingsSectionPorts;

/** The workbench host's directory port over its mocked Team routes. */
export const workbenchDirectory = async (): Promise<WorkbenchDirectory> =>
  hostJson(await fetch("/api/teams/workbench/apps"), workbenchDirectorySchema);

/** The workbench host's `computers()` port over its mocked Team routes. */
export const workbenchComputers = async (signal: AbortSignal) =>
  (
    await hostJson(
      await fetch("/api/teams/workbench/computers?limit=100&offset=0", {
        signal,
      }),
      teamComputerDirectorySchema,
    )
  ).computers;
