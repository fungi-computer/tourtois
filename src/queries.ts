/** Keep host and isolated-workbench reads in distinct cache entries. */
export const tourtoisQueryKeys = {
  hostSettings: (workspaceId: string) =>
    ["tourtois", "host-settings", workspaceId] as const,
  workbench: () => ["tourtois", "workbench"] as const,
  workbenchComputers: (teamId: string) =>
    ["tourtois", "workbench-computers", teamId] as const,
  appDirectory: (teamId: string) =>
    ["tourtois", "workbench-apps", teamId] as const,
};
