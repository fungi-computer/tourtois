import type { Story, StoryDefault } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DropdownMenuItem } from "@fungi.computer/caps/components/dropdown-menu";
import { toast } from "@fungi.computer/caps/components/toaster";
import { TeamTourtois } from "../src/TeamDesktop.js";
import { AppSurfaceHostProvider } from "../src/app-surface.js";
import {
  createPlatformControls,
  PlatformControlsView,
} from "../src/platform-controls.js";
import {
  createDesktopFixture,
  createInkcapComputerChoiceFixture,
} from "./fixtures.js";
import { MaosaicoRoot } from "@fungi.computer/maosaico";
import { AppPane } from "../src/AppPane.js";
import { TourtoisLayers } from "../src/layers.js";
import { useAppWindowManager } from "../src/useAppWindowManager.js";
import { attachWindowComputer } from "../src/app-launch.js";
import {
  workbenchComputers,
  workbenchDirectory,
  workbenchPorts,
} from "./host-ports.js";
import "./workbench.css";

export default { title: "Desktop" } satisfies StoryDefault;

function Desktop({
  fixture,
  demo = false,
  noticeProof = false,
}: {
  fixture: ReturnType<typeof createDesktopFixture>;
  demo?: boolean;
  noticeProof?: boolean;
}) {
  const [client] = useState(() => {
    fixture.reset();
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
  });
  const [host] = useState(fixture.host);
  const [destination, setDestination] = useState<string | null>(null);
  // The workbench stands in for Hub: it renders the platform controls on its
  // own (mocked) origin beside the desktop, as Hub does for the dashboard.
  const [controls] = useState(createPlatformControls);
  return (
    <div className="tourtois-study">
      <QueryClientProvider client={client}>
        <AppSurfaceHostProvider value={host}>
          <TeamTourtois
            teamId="workbench"
            teamName="Local workbench"
            platform={controls}
            directoryReader={workbenchDirectory}
            computersReader={workbenchComputers}
            desktopStorage={fixture.storage}
            desktopMethods={fixture.methods}
            gills={fixture.gills}
            children={
              <PlatformControlsView
                teamId="workbench"
                controls={controls}
                data={{ directory: workbenchDirectory, ...workbenchPorts }}
              />
            }
            systemMenuItems={
              noticeProof ? (
                <DropdownMenuItem
                  onSelect={() => {
                    toast("App selection changed. Your window stays open.", {
                      toasterId: "workbench-notices",
                      duration: Infinity,
                    });
                  }}
                >
                  Show layer notice
                </DropdownMenuItem>
              ) : demo ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      setDestination("/teams");
                    }}
                  >
                    Switch Team…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setDestination("/teams/workbench/members");
                    }}
                  >
                    Members
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setDestination("/account");
                    }}
                  >
                    Account…
                  </DropdownMenuItem>
                </>
              ) : undefined
            }
          />
          {destination ? (
            <output data-demo-destination={destination} hidden />
          ) : null}
        </AppSurfaceHostProvider>
      </QueryClientProvider>
    </div>
  );
}

const workspace = createDesktopFixture();
export const Workspace: Story = () => <Desktop fixture={workspace} />;
Workspace.msw = workspace.handlers;

// The actual Inkcap and widget producers, with a local host callback transport.
const computerChoice = createDesktopFixture("computer-choice");
export const ComputerChoice: Story = () => <Desktop fixture={computerChoice} />;
ComputerChoice.msw = computerChoice.handlers;

/** Controlled host state, not the Team desktop's auto-selected default launch. */
export const UnattachedInkcap: Story = () => {
  const [fixture] = useState(createInkcapComputerChoiceFixture);
  const [error, setError] = useState<string | null>(null);
  const manager = useAppWindowManager(fixture.host, "workbench", {
    onNavigation: () =>
      Promise.reject(new Error("No navigation in this proof")),
    onAppOpen: () => Promise.reject(new Error("No App opening in this proof")),
    onAppRole: () => Promise.resolve(null),
    onSelectionChanged: () => Promise.resolve(false),
    // This proof has one window, which is always the raised one.
    onAppFocus: () => undefined,
  });
  const snapshot = useSyncExternalStore(manager.subscribe, manager.read);
  const [bounds, setBounds] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const resized = () => {
      setBounds({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
    };
  }, []);
  useEffect(() => {
    void manager.open(fixture.launch).catch((cause: unknown) => {
      setError(String(cause));
    });
  }, [manager, fixture]);
  return (
    <div className="tourtois-study">
      <main className="tourtois-shell">
        <TourtoisLayers>
          <div className="tourtois-workbench">
            <MaosaicoRoot
              bounds={bounds}
              tiling={
                bounds.width <= 540
                  ? { mainSize: bounds.width, gap: 8 }
                  : undefined
              }
            >
              {error ? <p role="alert">{error}</p> : null}
              {snapshot.windows.map((projection, index) => (
                <AppPane
                  key={projection.windowId}
                  projection={projection}
                  icon={fixture.icon}
                  manager={manager}
                  index={index}
                  onError={setError}
                  focusWindow={() => undefined}
                  afterHide={() => undefined}
                  onBack={() => undefined}
                  onSelectComputer={(windowId, computerId) => {
                    void attachWindowComputer(
                      manager,
                      windowId,
                      computerId,
                    ).catch((cause: unknown) => {
                      setError(String(cause));
                    });
                  }}
                />
              ))}
            </MaosaicoRoot>
          </div>
        </TourtoisLayers>
      </main>
    </div>
  );
};

// Host-offered navigation only. No membership mutation or hosted Team data.
const demoNavigation = createDesktopFixture();
export const DemoNavigation: Story = () => (
  <Desktop fixture={demoNavigation} demo />
);
DemoNavigation.msw = demoNavigation.handlers;

const empty = createDesktopFixture("empty");
export const NoApps: Story = () => <Desktop fixture={empty} />;
NoApps.msw = empty.handlers;

const unavailable = createDesktopFixture("unavailable");
export const DirectoryUnavailable: Story = () => (
  <Desktop fixture={unavailable} />
);
DirectoryUnavailable.msw = unavailable.handlers;

const slow = createDesktopFixture("slow");
export const Loading: Story = () => <Desktop fixture={slow} />;
Loading.msw = slow.handlers;

const broken = createDesktopFixture("mount-error");
export const AppUnavailable: Story = () => <Desktop fixture={broken} />;
AppUnavailable.msw = broken.handlers;

const missingSession = createDesktopFixture("missing-session");
export const MissingSession: Story = () => <Desktop fixture={missingSession} />;
MissingSession.msw = missingSession.handlers;

const fresh = createDesktopFixture("fresh");
export const FreshTeam: Story = () => <Desktop fixture={fresh} />;
FreshTeam.msw = fresh.handlers;

const noAgents = createDesktopFixture("no-agents");
export const NoAgentsYet: Story = () => <Desktop fixture={noAgents} />;
NoAgentsYet.msw = noAgents.handlers;

const withGames = createDesktopFixture("games");
export const GamesInstalled: Story = () => <Desktop fixture={withGames} />;
GamesInstalled.msw = withGames.handlers;

// A two-page App reports Back; the focused window's chrome offers it.
const withPages = createDesktopFixture("pages");
export const AppBack: Story = () => <Desktop fixture={withPages} />;
AppBack.msw = withPages.handlers;

// The ordinary desktop fixture exercises all host-owned window controls.
const chrome = createDesktopFixture();
export const TouchChrome: Story = () => <Desktop fixture={chrome} />;
TouchChrome.msw = chrome.handlers;

const needsUpdate = createDesktopFixture("needs-update");
export const AppNeedsUpdate: Story = () => <Desktop fixture={needsUpdate} />;
AppNeedsUpdate.msw = needsUpdate.handlers;

// Real App windows exercise layer order beyond the shell's overlay token ranks.
const layers = createDesktopFixture("layers");
export const LayerStress: Story = () => <Desktop fixture={layers} />;
LayerStress.msw = layers.handlers;

const notices = createDesktopFixture("layer-notices");
/** The ordinary shell status and toast roots above a live local App window. */
export const OverlayNotices: Story = () => (
  <Desktop fixture={notices} noticeProof />
);
OverlayNotices.msw = notices.handlers;

const inboxUnavailable = createDesktopFixture("inbox-error");
export const InboxUnavailable: Story = () => (
  <Desktop fixture={inboxUnavailable} />
);
InboxUnavailable.msw = inboxUnavailable.handlers;

const unpublished = createDesktopFixture("unpublished-app");
export const UnpublishedApp: Story = () => <Desktop fixture={unpublished} />;
UnpublishedApp.msw = unpublished.handlers;

const workflows = createDesktopFixture("trellis");
export const WorkflowsIcon: Story = () => <Desktop fixture={workflows} />;
WorkflowsIcon.msw = workflows.handlers;
const workflowsMissingIcon = createDesktopFixture("workflows-missing-icon");
export const WorkflowsMissingIcon: Story = () => (
  <Desktop fixture={workflowsMissingIcon} />
);
WorkflowsMissingIcon.msw = workflowsMissingIcon.handlers;
