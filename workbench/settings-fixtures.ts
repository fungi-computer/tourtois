import {
  appPermissionFactsSchema,
  type AppDirectory,
} from "@fungi.computer/nacre/app-directory";
import { appDeclarationSchema } from "@fungi.computer/puffball/app";
import * as Schema from "effect/Schema";
import tourtoisManifest from "../package.json" with { type: "json" };
import vishnuManifest from "../../vishnu/package.json" with { type: "json" };

export type SettingsApp = AppDirectory["apps"][number];

const digest = `sha256:${"a".repeat(64)}`;
const declaredComputer = (capability: string) => ({
  capability,
  operations: [],
  fingerprints: {},
});
const approvedOn = (capability: string, ids: readonly string[]) => ({
  ...declaredComputer(capability),
  capabilityApproved: true,
  resources: ids.map((id) => ({ kind: "computer", id })),
});

/** Computer approvals the Settings workbench shows: selected Computers only. */
export const workbenchPermission = appPermissionFactsSchema.parse({
  authority: {
    authorityVersion: 1,
    declaredOperationsDigest: digest,
    approvedGrants: [
      approvedOn("computer.list", [
        "workbench-laptop",
        "studio",
        "travel-laptop",
      ]),
      approvedOn("computer.readFile", ["workbench-laptop", "studio"]),
      approvedOn("computer.writeFile", ["workbench-laptop"]),
    ],
    approval: null,
  },
  declaredOperations: {
    artifactDigest: digest,
    digest,
    capabilities: [
      declaredComputer("computer.list"),
      declaredComputer("computer.readFile"),
      declaredComputer("computer.writeFile"),
    ],
  },
  artifactDigest: digest,
  canEdit: true,
});

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
  declaredCapabilities:
    appId === "grove" ? ["channels.read", "channels.personal.manage"] : [],
  gills: roles.includes("inbox")
    ? [
        {
          view: "rows",
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
  permission: workbenchPermission,
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
