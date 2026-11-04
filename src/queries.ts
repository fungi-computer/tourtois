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
  oysterKeepAwake: (teamId: string, computerId: string) =>
    ["tourtois", "oyster-keep-awake", teamId, computerId] as const,
  oysterEgressPolicy: (teamId: string) =>
    ["tourtois", "oyster-egress-policy", teamId] as const,
  websiteChannels: (scope: string) =>
    ["tourtois", "website-channels", scope] as const,
  websiteConversations: (scope: string, bindingId: string) =>
    [...tourtoisQueryKeys.websiteChannels(scope), bindingId] as const,
  websiteTranscript: (scope: string, bindingId: string, sessionId: string) =>
    [
      ...tourtoisQueryKeys.websiteConversations(scope, bindingId),
      sessionId,
    ] as const,
  hostSettings: (workspaceId: string) =>
    ["tourtois", "host-settings", workspaceId] as const,
  workbench: () => ["tourtois", "workbench"] as const,
  workbenchComputers: (teamId: string) =>
    ["tourtois", "workbench-computers", teamId] as const,
  appDirectory: (teamId: string) =>
    ["tourtois", "workbench-apps", teamId] as const,
};
