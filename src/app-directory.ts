import { tourtoisQueryKeys } from "./queries.js";
import { useQuery } from "@tanstack/react-query";

import {
  workbenchDirectorySchema,
  type WorkbenchDirectory,
} from "@fungi.computer/nacre/workbench-directory";

const noRoles: WorkbenchDirectory["roles"] = {};

/** Shell composition keeps an unread directory distinct from an empty one. */
export function useAppDirectory(
  teamId: string,
  directoryReader: () => Promise<WorkbenchDirectory>,
) {
  const query = useQuery({
    queryKey: tourtoisQueryKeys.appDirectory(teamId),
    queryFn: async () =>
      workbenchDirectorySchema.parse(await directoryReader()),
    retry: false,
    // The host's selection read can finish before Tourtois mounts. Keep the
    // result fresh for that handoff; explicit mutations still invalidate it.
    staleTime: 5_000,
    // Quiet open Apps need release availability too, not just after a request
    // is refused. Every directory read costs the host a Registry read, and
    // explicit mutations already invalidate this query, so the poll is a slow
    // backstop. React Query pauses it while the page is hidden.
    refetchInterval: 60_000,
  });
  return {
    query,
    apps: query.data?.apps,
    needsUpdate: query.data?.needsUpdate ?? [],
    roles: query.data?.roles ?? noRoles,
  };
}
