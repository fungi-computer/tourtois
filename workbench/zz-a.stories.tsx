import type { Story, StoryDefault } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { TeamTourtois } from "../src/TeamDesktop.js";
import { AppSurfaceHostProvider } from "../src/app-surface.js";
import {
  createPlatformControls,
  PlatformControlsView,
} from "../src/platform-controls.js";
import { createDesktopFixture } from "./fixtures.js";
import {
  workbenchComputers,
  workbenchDirectory,
  workbenchPorts,
} from "./host-ports.js";
import "./workbench.css";
export default { title: "Ashots" } satisfies StoryDefault;
const fixture = createDesktopFixture();
export const NoAvatar: Story = () => {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [host] = useState(fixture.host);
  const [controls] = useState(createPlatformControls);
  return (
    <div className="tourtois-study">
      <QueryClientProvider client={client}>
        <AppSurfaceHostProvider value={host}>
          <TeamTourtois
            teamId="workbench"
            teamName="Oyster"
            platform={controls}
            settingsSections={[
              "home",
              "apps",
              "connectors",
              "computers",
              "keys",
              "channels",
            ]}
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
          />
        </AppSurfaceHostProvider>
      </QueryClientProvider>
    </div>
  );
};
NoAvatar.msw = fixture.handlers;
