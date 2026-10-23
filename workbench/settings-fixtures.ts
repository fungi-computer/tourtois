import type { AppDirectory } from "@fungi.computer/nacre/app-directory";
import { appDeclarationSchema } from "@fungi.computer/puffball/app";
import * as Schema from "effect/Schema";
import tourtoisManifest from "../package.json" with { type: "json" };
import vishnuManifest from "../../vishnu/package.json" with { type: "json" };

export type SettingsApp = AppDirectory["apps"][number];

const app = (
  appId: string,
  displayName: string,
  icon: string | null,
  roles: readonly string[],
): SettingsApp => ({
  address: { kind: "default", appId },
  installationId: null,
  appId,
  displayName,
  releaseId: "workbench-release",
  override: null,
  authorityVersion: 1,
  enforcement: null,
  grants: [],
  declaredCapabilities:
    appId === "grove" ? ["channels.read", "channels.personal.manage"] : [],
  gills: roles.includes("inbox")
    ? [
        {
          id: "inbox",
          title: "Inbox",
          source: "listInbox",
          desktop: { sizes: ["S", "M", "L"] },
        },
      ]
    : [],
  surfaceId: appId,
  icon,
  availability: "available",
  roles: [...roles],
  handlers: [],
  commands: [],
  surface: null,
  surfacePath: `/${appId}`,
  computerPermission: {
    kind: "selected-computers",
    computers: [
      {
        computerId: "workbench-laptop",
        operations: [
          "computer.list",
          "computer.readFile",
          "computer.writeFile",
        ],
      },
      {
        computerId: "studio",
        operations: ["computer.list", "computer.readFile"],
      },
      { computerId: "travel-laptop", operations: ["computer.list"] },
    ],
  },
  generationPermissions: { llm: false, media: false },
  marketplacePermissions: {
    browse: false,
    purchase: false,
    installFree: false,
  },
  agentPermission: {
    kind: "all-team-agents" as const,
    directoryOperations: [],
    sessionOperations: [],
  },
});

export const settingsApps: readonly SettingsApp[] = [
  app("inkcap", "Inkcap", "inkcap", ["files"]),
  app("prints", "Prints", "prints", ["media"]),
  app("grove", "Grove", "chat", ["inbox", "sessions"]),
  app("shed", "Shed", "computer", ["terminal"]),
];

export const settingsIconApps: readonly SettingsApp[] = [
  ...[
    {
      appId: "tourtois",
      displayName: "Tourtois",
      input: tourtoisManifest.fungi.app,
    },
    { appId: "vishnu", displayName: "Vishnu", input: vishnuManifest.fungi.app },
  ].map(({ appId, displayName, input }) => {
    const declaration = Schema.decodeUnknownSync(appDeclarationSchema)(input);
    return app(appId, displayName, declaration.icon ?? null, declaration.roles);
  }),
  app("unknown", "Unknown App", null, []),
];
