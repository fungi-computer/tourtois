import {
  createDesktopMethodsFixture,
  desktopCatalogFixture,
} from "./desktop-methods.fixture.js";
import workflowsManifest from "../../trellis/package.json";
import { appBackend as groveBackend } from "../../grove/backend/methods.js";
import { recentFilesGill } from "../../inkcap/backend/gills.js";
import type { DesktopGillTransport } from "../src/desktop/row-gill.js";
import { createDesktopStorageFixture } from "./desktop-storage.fixture.js";
import {
  type AppDirectory,
  appAddressSchema,
} from "@fungi.computer/nacre/app-directory";
import { createQueryClient } from "@fungi.computer/agar/query";
import {
  defaultMemberAvatar,
  memberAvatarSchema,
  type MemberAvatar,
} from "@fungi.computer/sprite-zdog/avatar";
import { msw } from "@ladle/react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InboxApp } from "../../grove/src/inbox.js";
import { createGroveFixture } from "../../grove/workbench/fixtures.js";
import "@fungi.computer/parakeet/styles.css";
import { InkcapApp } from "../../inkcap/src/InkcapApp.js";
import {
  createInkcapFixture,
  projectPath,
} from "../../inkcap/workbench/fixtures.js";
import { MediaPane } from "../../prints/src/MediaPane.js";
import { createPrintsFixture } from "../../prints/workbench/fixtures.js";
import { createAppSurfaceCommandHost } from "@fungi.computer/nacre/command-host";
import { mountLocalCommands } from "./local-commands.js";
import { PagesDemo } from "./pages-demo.js";
import type {
  AppBackHandler,
  AppRoot,
  AppStatusActionHandler,
  HostNavigation,
} from "@fungi.computer/agar";
import { ShedWorkspaceView } from "../../shed/src/shed-app.js";
import { ShedDataContext } from "../../shed/src/shed-data.js";
import { createShedFixture } from "../../shed/workbench/fixtures.js";
import { WorkflowEditor } from "../../trellis/src/editor/editor.js";
import {
  emptyDraft,
  memoryDraftStore,
} from "../../trellis/src/editor/draft-store.js";
import { groveApp, inkcapApp, printsApp } from "./app-manifests.fixture.js";
import { appDeclarationSchema } from "@fungi.computer/puffball/app";
import * as Schema from "effect/Schema";
import type { TourtoisAppSurfaceHost } from "../src/app-surface.js";
import type { AppLaunchDescriptor } from "../src/app-windows.js";
import { launchComputerId } from "../src/app-launch.js";
import { appPermissionChangesSchema } from "../src/app-authority.js";
import { buildAppDeclaration } from "@fungi.computer/agar/backend-declaration";
import { appBackend as chatBackend } from "../../grove/backend/methods.js";
const groveDeclaration = buildAppDeclaration(chatBackend, groveApp);

const computers = [
  {
    computerId: "workbench-laptop",
    name: "Workbench",
    createdAt: 1,
    updatedAt: 1,
  },
  { computerId: "studio", name: "Studio", createdAt: 1, updatedAt: 1 },
  {
    computerId: "travel-laptop",
    name: "Travel laptop",
    createdAt: 1,
    updatedAt: 1,
  },
];

const mutation = z.object({
  target: appAddressSchema,
  expectedVersion: z.number(),
  command: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("set-permissions"),
      permissions: appPermissionChangesSchema,
    }),
    z.object({
      kind: z.literal("select"),
      releaseId: z.string().min(1),
      surfaceRoute: z.string().nullable(),
    }),
    z.object({ kind: z.literal("reset") }),
  ]),
});

function appDirectory(
  withGames = false,
  withPages = false,
  withLayers = false,
  withWorkflows = false,
  computerChoice = false,
): AppDirectory["apps"] {
  const workflowsDeclaration = Schema.decodeUnknownSync(appDeclarationSchema)(
    workflowsManifest.fungi.app,
  );
  // The Release-declared Computer rights decide which Apps attach to one.
  const capabilities = new Map<string, readonly string[]>([
    ["inkcap", inkcapApp.capabilities],
    ["prints", printsApp.capabilities],
    ["shed", ["computer.execute"]],
    ["trellis", workflowsManifest.fungi.app.capabilities],
  ]);
  const declarations = new Map([
    [
      "inkcap",
      Schema.decodeUnknownSync(appDeclarationSchema)(inkcapApp).commands ?? [],
    ],
    [
      "prints",
      Schema.decodeUnknownSync(appDeclarationSchema)(printsApp).commands ?? [],
    ],
    [
      "grove",
      Schema.decodeUnknownSync(appDeclarationSchema)(groveApp).commands ?? [],
    ],
  ]);
  return [
    {
      appId: "inkcap",
      displayName: "Inkcap",
      icon: "inkcap",
      roles: ["files"],
    },
    {
      appId: "prints",
      displayName: "Prints",
      icon: "prints",
      roles: ["media"],
    },
    {
      appId: "grove",
      displayName: "Grove",
      icon: "chat",
      roles: ["inbox", "sessions"],
    },
    {
      appId: "shed",
      displayName: "Shed",
      icon: "computer",
      roles: ["terminal"],
    },
    ...(withWorkflows
      ? [
          {
            appId: "trellis",
            displayName: workflowsDeclaration.displayName ?? "Trellis",
            icon: workflowsDeclaration.icon ?? null,
            roles: [...workflowsDeclaration.roles],
          },
        ]
      : []),
    // The Games App ships separately; a Team that installed it fills `games`.
    ...(withGames
      ? [
          {
            appId: "games",
            displayName: "Games",
            icon: "games",
            roles: ["games"],
          },
        ]
      : []),
    // A two-page demo App that reports Back to its window chrome.
    ...(withPages
      ? [
          {
            appId: "pages",
            displayName: "Pages",
            icon: "read",
            roles: [],
          },
        ]
      : []),
    ...(withLayers
      ? Array.from({ length: 31 }, (_, index) => ({
          appId: `layer-${String(index + 1).padStart(2, "0")}`,
          displayName: `Layer ${String(index + 1).padStart(2, "0")}`,
          icon: "read",
          roles: [],
        }))
      : []),
  ].map((app) => ({
    ...app,
    commands: [...(declarations.get(app.appId) ?? [])],
    gills:
      app.appId === "grove"
        ? [...(groveDeclaration.gills ?? [])]
        : app.appId === "inkcap" && computerChoice
          ? [recentFilesGill.declaration]
          : [],
    address: { kind: "default" as const, appId: app.appId },
    installationId: null,
    surfaceId: app.appId,
    releaseId: "workbench-release",
    override: null,
    authorityVersion: 1,
    enforcement: null,
    grants: [],
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
    handlers: [],
    declaredCapabilities: [...(capabilities.get(app.appId) ?? [])],
    availability: "available",
    surface: { stableRoute: "main" },
    surfacePath: `/workbench-apps/${app.appId}`,
  }));
}

const teamGitGrantCommand = z.object({
  expectedVersion: z.number().int().positive().nullable(),
  operations: z.array(z.string()),
  repositories: z.unknown(),
});

/** Mirror Hub's role projection: the choice, else the first App filling it. */
function fixtureRoles(
  listed: readonly { surfaceId: string; roles: readonly string[] }[],
  chosen: ReadonlyMap<string, string>,
) {
  return Object.fromEntries(
    ["inbox", "files", "media", "sessions", "terminal", "games"].map((role) => {
      const fills = listed.filter((app) => app.roles.includes(role));
      const picked = fills.find((app) => app.surfaceId === chosen.get(role));
      const pick = picked ?? fills.at(0);
      return [
        role,
        { surfaceId: pick?.surfaceId ?? null, chosen: picked !== undefined },
      ];
    }),
  );
}

/** Network fixtures stay outside production: the shell uses its ordinary queries. */
export function createDesktopFixture(
  scenario:
    | "computer-choice"
    | "inbox-error"
    | "needs-update"
    | "trellis"
    | "workflows-missing-icon"
    | "unpublished-app"
    | "ready"
    | "empty"
    | "unavailable"
    | "slow"
    | "layer-notices"
    | "mount-error"
    | "missing-session"
    | "fresh"
    | "no-agents"
    | "games"
    | "pages"
    | "layers"
    | "hero" = "ready",
) {
  // A fresh Team has its Apps but no conversations yet.
  const noSessions =
    scenario === "empty" ||
    scenario === "fresh" ||
    scenario === "no-agents" ||
    scenario === "games";
  let apps = appDirectory(
    scenario === "games",
    scenario === "pages",
    scenario === "layers",
    scenario === "trellis" || scenario === "workflows-missing-icon",
    scenario === "computer-choice",
  );
  const chosenRoles = new Map<string, string>();
  let avatar: MemberAvatar = defaultMemberAvatar;
  let trackerGrant: {
    teamId: string;
    repository: string;
    branch: "main";
    provider: string;
    revision: number;
    consentedByUserId: string;
    consentedAt: number;
    state: "active" | "revoked";
  } | null = null;
  let teamGitGrants: {
    agentId: string;
    version: number;
    operations: string[];
    repositories: unknown;
  }[] = [];
  let recentUpdateAvailable = false;
  const gillListeners = new Set<() => Promise<void>>();
  const gills: DesktopGillTransport = {
    requestGill(request) {
      if (scenario === "computer-choice" && request.surfaceId === "inkcap")
        return recentFilesGill.call(
          { id: request.viewId, params: request.params },
          () => Promise.resolve({ error: "not_granted" }),
        );
      return groveBackend.gill(
        {
          id: request.viewId,
          params: request.params,
          after: request.after,
          options: request.options,
        },
        {
          env: {
            INBOX: {
              async page({ after }) {
                const suffix =
                  after === null ? "" : `?after=${encodeURIComponent(after)}`;
                const response = await fetch(
                  `/api/teams/workbench/inbox${suffix}`,
                );
                if (!response.ok) throw new Error("Fixture Inbox read refused");
                return z.json().parse(await response.json());
              },
              visit: () =>
                Promise.reject(new Error("Gill reads must not visit")),
            },
          },
        },
        {
          computerId: null,
          actor: { kind: "member", memberId: "workbench-person" },
        },
      );
    },
    watchGillChanges(_input, onChanged) {
      gillListeners.add(onChanged);
      return Promise.resolve({
        close() {
          gillListeners.delete(onChanged);
          return Promise.resolve();
        },
      });
    },
  };
  const storage = createDesktopStorageFixture();
  return {
    storage,
    methods: createDesktopMethodsFixture(storage, () =>
      desktopCatalogFixture(apps, fixtureRoles(apps, chosenRoles)),
    ),
    gills,
    activateNewVersion: () => {
      const app = apps.find((item) => item.appId === "inkcap");
      if (!app) throw new Error("Inkcap fixture missing");
      app.releaseId = "workbench-release-next";
      app.authorityVersion += 1;
    },
    reset: () => {
      apps = appDirectory(
        scenario === "games",
        scenario === "pages",
        scenario === "layers",
        scenario === "trellis" || scenario === "workflows-missing-icon",
        scenario === "computer-choice",
      );
      chosenRoles.clear();
      avatar = defaultMemberAvatar;
      teamGitGrants = [];
      trackerGrant = null;
      recentUpdateAvailable = false;
    },
    host: () =>
      createFixtureHost(
        scenario === "mount-error",
        scenario === "missing-session",
        scenario === "computer-choice",
        scenario === "hero",
      ),
    handlers: [
      msw.http.get("/api/account", () =>
        msw.HttpResponse.json({
          actor: {
            userId: "workbench-person",
            name: "Workbench Person",
            avatar,
          },
          providers: { email: true, github: false },
          sessions: [],
          reauthenticationRequired: false,
        }),
      ),
      msw.http.put("/api/account/avatar", async ({ request }) => {
        const parsed = memberAvatarSchema.safeParse(await request.json());
        if (!parsed.success) return new msw.HttpResponse(null, { status: 400 });
        avatar = parsed.data;
        return msw.HttpResponse.json(avatar);
      }),
      // This owner Settings scenario models an explicitly qualified environment.
      msw.http.get("/api/teams/workbench/closure", () =>
        msw.HttpResponse.json({
          team: {
            teamId: "workbench",
            name: "Workbench Team",
            handle: "workbench",
            ownerId: "workbench-person",
          },
          activated: true,
          state: "open",
          closedAt: null,
          requestId: null,
          protected: null,
          balance: {
            amount: "2383125",
            currency: { code: "USD", base: 10, exponent: 2 },
            scale: 5,
          },
          openInvoiceIds: [],
          canClose: true,
        }),
      ),
      msw.http.get("/api/teams/workbench/computers", () =>
        msw.HttpResponse.json({
          // The hero shot names its Computer as a Team would.
          computers:
            scenario === "hero"
              ? computers.map((computer) =>
                  computer.computerId === "workbench-laptop"
                    ? { ...computer, name: "fernwood-studio" }
                    : computer,
                )
              : computers,
          nextOffset: null,
        }),
      ),
      msw.http.get("/api/teams/workbench/agents", () =>
        msw.HttpResponse.json({
          agents: (scenario === "no-agents"
            ? []
            : [
                ["gardener", "Gardener"],
                ["librarian", "Librarian"],
                ["maker", "Maker"],
              ]
          ).map(([agentId, name]) => ({
            agentId,
            name,
            createdAt: 0,
            updatedAt: 0,
          })),
        }),
      ),
      msw.http.get("/api/teams/workbench/inbox", () => {
        if (scenario === "unavailable" || scenario === "inbox-error")
          return msw.HttpResponse.json(
            { error: "Fixture resource unavailable" },
            { status: 503 },
          );
        const now = Date.now();
        const item = (
          agentId: string,
          title: string,
          state: "running" | "errored" | "done",
          minutes: number,
          index: number,
        ) => {
          const at = now - minutes * 60_000;
          const base = {
            agentId,
            sessionId:
              scenario === "missing-session" && index === 1
                ? "gone-session"
                : `${agentId}-${String(index)}`,
            title,
            createdAt: at,
            lastActivityAt: at,
            state,
          };
          return state === "running" ? base : { ...base, settledAt: at };
        };
        return msw.HttpResponse.json({
          items: noSessions
            ? []
            : [
                item(
                  "gardener",
                  "A planting plan for the courtyard",
                  "running",
                  0,
                  0,
                ),
                item("gardener", "Spring notes, collected", "errored", 10, 1),
                item("librarian", "Sketching the seed library", "done", 20, 2),
                item("maker", "The next small experiment", "done", 90, 3),
                item("librarian", "A quiet corner for ferns", "done", 1500, 4),
                ...(recentUpdateAvailable
                  ? [
                      item(
                        "maker",
                        "Updated while Apps were minimized",
                        "running",
                        0,
                        5,
                      ),
                    ]
                  : []),
              ],
          next: null,
          cursor: 0,
        });
      }),
      msw.http.get(
        "/api/teams/workbench/inbox/events",
        () =>
          new msw.HttpResponse(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(": inbox\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
      msw.http.post("/api/teams/workbench/test/recent-update", () => {
        recentUpdateAvailable = true;
        for (const notify of gillListeners)
          void notify().catch((cause: unknown) => {
            console.error("Fixture Gill refresh failed", cause);
          });
        return new msw.HttpResponse(null, { status: 204 });
      }),
      msw.http.get("/api/teams/workbench/apps", async () => {
        if (scenario === "slow") await msw.delay(2500);
        if (scenario === "unavailable")
          return msw.HttpResponse.json(
            { error: "Fixture resource unavailable" },
            { status: 503 },
          );
        const listed =
          scenario === "empty"
            ? []
            : scenario === "workflows-missing-icon"
              ? apps.map((app) =>
                  app.appId === "trellis" ? { ...app, icon: null } : app,
                )
              : scenario === "unpublished-app"
                ? apps.map((app) =>
                    app.appId === "inkcap"
                      ? {
                          ...app,
                          displayName: "Sketchbook",
                          icon: null,
                          roles: [],
                          availability: "unavailable" as const,
                          releaseId: null,
                          surface: null,
                        }
                      : app,
                  )
                : apps;
        const directory: AppDirectory = {
          actorIsTeamOwner: true,
          apps:
            scenario === "layer-notices"
              ? listed.map((app) =>
                  app.appId === "inkcap"
                    ? { ...app, availability: "unavailable" }
                    : app,
                )
              : listed,
          roles: fixtureRoles(listed, chosenRoles),
        };
        if (scenario === "needs-update")
          directory.needsUpdate = [
            {
              installationId: "installation_workflows",
              appId: "app_trellis",
              displayName: "Trellis",
            },
          ];
        return msw.HttpResponse.json(directory);
      }),
      msw.http.put(
        "/api/teams/workbench/apps/roles/:role",
        async ({ params, request }) => {
          const role = z.string().min(1).parse(params.role);
          const parsed = z
            .object({ surfaceId: z.string().min(1).nullable() })
            .safeParse(await request.json());
          if (!parsed.success)
            return new msw.HttpResponse(null, { status: 400 });
          if (parsed.data.surfaceId === null) chosenRoles.delete(role);
          else chosenRoles.set(role, parsed.data.surfaceId);
          return msw.HttpResponse.json({
            roles: fixtureRoles(apps, chosenRoles),
          });
        },
      ),
      msw.http.post("/api/teams/workbench/apps", async ({ request }) => {
        const parsed = mutation.safeParse(await request.json());
        if (!parsed.success) return new msw.HttpResponse(null, { status: 400 });
        const { target, expectedVersion, command } = parsed.data;
        const app =
          target.kind === "default"
            ? apps.find((item) => item.appId === target.appId)
            : undefined;
        if (!app) return new msw.HttpResponse(null, { status: 404 });
        if (app.authorityVersion !== expectedVersion)
          return new msw.HttpResponse(null, { status: 409 });
        if (command.kind === "set-permissions") {
          const permissions = command.permissions;
          if (permissions.computer !== undefined)
            app.computerPermission = permissions.computer;
          if (permissions.agents !== undefined)
            app.agentPermission = permissions.agents;
          if (permissions.generation !== undefined)
            app.generationPermissions = permissions.generation;
          if (permissions.marketplace !== undefined)
            app.marketplacePermissions = permissions.marketplace;
        } else if (command.kind === "select") {
          app.override = {
            releaseId: command.releaseId,
            surfaceRoute: command.surfaceRoute,
          };
          app.releaseId = command.releaseId;
        } else {
          app.override = null;
          app.releaseId = "workbench-release";
        }
        app.authorityVersion += 1;
        return msw.HttpResponse.json({
          kind: "accepted",
          receipt: {
            authorityVersion: app.authorityVersion,
            computerPermission: app.computerPermission,
            generationPermissions: app.generationPermissions,
            marketplacePermissions: app.marketplacePermissions,
            agentPermission: app.agentPermission,
          },
          enforcement: null,
        });
      }),
      msw.http.get("/api/teams/workbench/agents", () =>
        msw.HttpResponse.json({
          agents: [
            { agentId: "gardener", name: "Gardener" },
            { agentId: "librarian", name: "Librarian" },
          ],
        }),
      ),
      msw.http.all(
        "/api/teams/workbench/integrations/git",
        async ({ request }) => {
          if (request.method !== "GET") {
            if (!["POST", "DELETE"].includes(request.method))
              return new msw.HttpResponse(null, { status: 405 });
            await msw.delay(250);
            trackerGrant = {
              teamId: "workbench",
              repository: `tracker-${"a".repeat(64)}`,
              branch: "main",
              provider: "artifacts",
              revision: (trackerGrant?.revision ?? 0) + 1,
              consentedByUserId: "owner",
              consentedAt: Date.now(),
              state: request.method === "POST" ? "active" : "revoked",
            };
          }
          return msw.HttpResponse.json({ grant: trackerGrant });
        },
      ),
      msw.http.get("/api/teams/workbench/git/team/grants", () =>
        msw.HttpResponse.json({ grants: teamGitGrants }),
      ),
      msw.http.put(
        "/api/teams/workbench/git/team/grants/:agentId",
        async ({ request, params }) => {
          const parsed = teamGitGrantCommand.safeParse(await request.json());
          const agentId = z.string().safeParse(params.agentId);
          if (!parsed.success || !agentId.success)
            return new msw.HttpResponse(null, { status: 400 });
          const current = teamGitGrants.find(
            (grant) => grant.agentId === agentId.data,
          );
          if ((current?.version ?? null) !== parsed.data.expectedVersion)
            return new msw.HttpResponse(null, { status: 409 });
          teamGitGrants = teamGitGrants.filter(
            (grant) => grant.agentId !== agentId.data,
          );
          if (parsed.data.operations.length === 0)
            return msw.HttpResponse.json({ grant: null });
          const grant = {
            agentId: agentId.data,
            version: (current?.version ?? 0) + 1,
            operations: parsed.data.operations,
            repositories: parsed.data.repositories,
          };
          teamGitGrants.push(grant);
          return msw.HttpResponse.json({ grant });
        },
      ),
      // No workbench mutation may fall through to a real server.
      msw.http.all("/api/*", () =>
        msw.HttpResponse.json(
          { error: "This operation has no workbench fixture." },
          { status: 501 },
        ),
      ),
    ],
  };
}

/** An explicitly unattached host window; its launch also owns the child context. */
export function createInkcapComputerChoiceFixture() {
  const declaration = Schema.decodeUnknownSync(appDeclarationSchema)(inkcapApp);
  const launch: AppLaunchDescriptor = {
    windowId: "app:inkcap",
    surfaceId: "inkcap",
    installationId: null,
    appId: "inkcap",
    releaseId: "workbench-release",
    title: declaration.displayName ?? "Inkcap",
    href: "/apps/inkcap",
    openRequest: null,
    roles: declaration.roles,
    commands: declaration.commands ?? [],
    computers,
  };
  return {
    launch,
    icon: declaration.icon ?? null,
    host: createFixtureHost(false, false, true),
  };
}

/** Opens the Gardener conversation Grove's own timeline scenario provides. */
const heroGroveOpenRequest = {
  kind: "navigate" as const,
  requestId: "hero-open-gardener",
  params: [
    { key: "agent", value: "gardener" },
    { key: "session", value: "gardener-1" },
  ],
};

/** Production app components; only Computer capabilities and shell HTTP are local. */
function createFixtureHost(
  failMount: boolean,
  missingSession: boolean,
  computerChoice = false,
  hero = false,
): TourtoisAppSurfaceHost {
  const commands = createAppSurfaceCommandHost();
  return {
    mount: async (container, initialLaunch, signal, events) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (failMount) throw new Error("Fixture App could not be mounted");
      const commandMount = await mountLocalCommands(
        commands,
        initialLaunch.surfaceId,
        initialLaunch.commands,
      );
      try {
        signal.throwIfAborted();
      } catch (error) {
        commandMount.dispose();
        throw error;
      }
      let currentLaunch = initialLaunch;
      const root = createRoot(container);
      // The demo App speaks the same navigation contract an iframe App
      // does; only the transport is local.
      let back: AppBackHandler | undefined;
      const navigation: HostNavigation = {
        publish: (state) => {
          events.onNavigationState?.(state);
          return Promise.resolve();
        },
        onActivate: () => () => undefined,
        onBack: (handler) => {
          back = handler;
          return () => {
            if (back === handler) back = undefined;
          };
        },
      };
      const pages =
        initialLaunch.appId === "pages" ||
        initialLaunch.appId.startsWith("layer-")
          ? navigation
          : null;
      // Each App reports its readouts; the shell renders them in the window's
      // status bar, as it would for an isolated App.
      let statusAction: AppStatusActionHandler | undefined;
      const status: Pick<AppRoot["ui"], "reportStatus" | "onStatusAction"> = {
        reportStatus: (items) => {
          events.onStatusItems?.(items);
          return Promise.resolve();
        },
        onStatusAction: (handler) => {
          statusAction = handler;
          return () => {
            if (statusAction === handler) statusAction = undefined;
          };
        },
      };
      const createInkcap = (launch: AppLaunchDescriptor) => {
        const computerId = computerChoice
          ? launchComputerId(launch.href)
          : "workbench-laptop";
        const inkcap =
          launch.appId === "inkcap"
            ? createInkcapFixture(
                computerId === null ? "no-computer-selected" : "workspace",
                computerId,
                commandMount.commands,
                navigation,
                status,
              )
            : null;
        if (inkcap && computerChoice)
          inkcap.connection.app.ui.requestComputerChoice = () =>
            new Promise<void>((resolve, reject) => {
              // Preserve the asynchronous message hop of an isolated App's RPC.
              const channel = new MessageChannel();
              channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                if (!events.onComputerChoice) {
                  reject(new Error("Computer choice host missing"));
                  return;
                }
                void events.onComputerChoice().then(resolve, reject);
              };
              channel.port2.postMessage(null);
            });
        return inkcap;
      };
      let inkcap = createInkcap(initialLaunch);
      const shed =
        initialLaunch.appId === "shed" ? createShedFixture({ status }) : null;
      const workflows =
        initialLaunch.appId === "trellis"
          ? memoryDraftStore(emptyDraft(), {})
          : null;
      const prints =
        initialLaunch.appId === "prints"
          ? createPrintsFixture(
              "studio",
              () => {
                throw new Error(
                  "Cross-app file handoff is not connected in this local workbench.",
                );
              },
              "workbench-laptop",
              { status },
            )
          : null;
      const grove =
        initialLaunch.appId === "grove"
          ? createGroveFixture(
              hero ? "timeline" : "inbox",
              // The hero shot opens Grove's own richer conversation.
              hero ? heroGroveOpenRequest : initialLaunch.openRequest,
              missingSession ? ["gone-session"] : [],
            )
          : null;
      const queryClient =
        inkcap || prints
          ? createQueryClient()
          : grove
            ? new QueryClient({ defaultOptions: { queries: { retry: false } } })
            : null;
      if (!inkcap && !prints && !grove && !pages && !shed && !workflows) {
        root.unmount();
        commandMount.dispose();
        throw new Error(`No local app surface for ${initialLaunch.appId}`);
      }
      container.dataset.workbenchApp = initialLaunch.appId;
      const render = () => {
        const currentInkcap = inkcap;
        root.render(
          currentInkcap && queryClient ? (
            <QueryClientProvider client={queryClient}>
              <LocalInkcap
                fixture={currentInkcap}
                computerName={
                  currentLaunch.computers?.find(
                    (computer) =>
                      computer.computerId === currentInkcap.computerId,
                  )?.name ?? null
                }
              />
            </QueryClientProvider>
          ) : pages ? (
            <PagesDemo navigation={pages} />
          ) : grove && queryClient ? (
            <QueryClientProvider client={queryClient}>
              <InboxApp {...grove} />
            </QueryClientProvider>
          ) : prints && queryClient ? (
            <QueryClientProvider client={queryClient}>
              <MediaPane connection={{ app: prints }} />
            </QueryClientProvider>
          ) : shed ? (
            <ShedDataContext.Provider
              value={{
                ports: { status: "loaded", items: [] },
                processes: { items: [], loading: false, error: false },
              }}
            >
              <ShedWorkspaceView app={shed.app} computerId="Workbench" />
            </ShedDataContext.Provider>
          ) : workflows ? (
            <WorkflowEditor store={workflows} active />
          ) : null,
        );
      };
      render();
      return {
        setVisibility: (visibility) => {
          container.dataset.visibility = visibility;
        },
        reconfigure: (nextLaunch) => {
          currentLaunch = nextLaunch;
          if (inkcap && computerChoice) {
            inkcap.connection.app.dispose();
            inkcap = createInkcap(nextLaunch);
          }
          grove?.updateOpenRequest(nextLaunch.openRequest);
          render();
        },
        requestClose: async () => (await inkcap?.requestClose()) ?? true,
        requestBack: async () => (await back?.()) ?? false,
        activateNavigation: () => Promise.resolve(false),
        activateStatus: async (action) =>
          (await statusAction?.(action)) ?? false,
        dispose: () =>
          Promise.resolve().then(() => {
            root.unmount();
            inkcap?.connection.app.dispose();
            prints?.dispose();
            queryClient?.clear();
            commandMount.dispose();
          }),
      };
    },
    menu: commands.menu,
    snapshot: commands.snapshot,
    active: commands.active,
    registerShellCommands: commands.registerShellCommands,
    registerDirectoryCommands: commands.registerDirectoryCommands,
    execute: commands.execute,
    subscribe: commands.subscribe,
    focus: commands.focus,
  };
}

function LocalInkcap({
  fixture,
  computerName,
}: {
  fixture: ReturnType<typeof createInkcapFixture>;
  computerName: string | null;
}) {
  const [error, setError] = useState("");
  useEffect(() => {
    if (fixture.computerId === null) return;
    void fixture
      .open(`${projectPath}/src/garden.ts`)
      .catch((cause: unknown) => {
        setError(String(cause));
      });
  }, [fixture]);
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <InkcapApp
        connection={fixture.connection}
        context={{
          computerId: fixture.computerId,
          computerName,
          projectPath,
        }}
      />
    </>
  );
}
