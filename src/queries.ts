/** Keep host and isolated-workbench reads in distinct cache entries. */
export const tourtoisQueryKeys = {
  oysterComputers: (teamId: string) =>
    ["tourtois", "oyster-computers", teamId] as const,
  oysterComputerPage: (teamId: string, offset: number) =>
    [...tourtoisQueryKeys.oysterComputers(teamId), offset] as const,
  oysterSelectedComputer: (teamId: string) =>
    ["tourtois", "oyster-selected-computer", teamId] as const,
  oysterInternetAccess: (teamId: string, computerId: string) =>
    ["tourtois", "oyster-internet-access", teamId, computerId] as const,
  oysterEgressPolicy: (teamId: string) =>
    ["tourtois", "oyster-egress-policy", teamId] as const,
  hostSettings: (workspaceId: string) =>
    ["tourtois", "host-settings", workspaceId] as const,
  workbench: () => ["tourtois", "workbench"] as const,
  workbenchComputers: (teamId: string) =>
    ["tourtois", "workbench-computers", teamId] as const,
  appDirectory: (teamId: string) =>
    ["tourtois", "workbench-apps", teamId] as const,
};
