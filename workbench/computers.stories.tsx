import type { Story, StoryDefault } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import {
  OysterComputers,
  type OysterComputersPort,
} from "../src/OysterComputers.js";
import { SystemSettings } from "../src/SystemSettings.js";
import type { SettingsLocation } from "../src/settings-routes.js";
import "./workbench.css";

export default { title: "Desktop / Computers" } satisfies StoryDefault;

const ids = defineIdFamily({
  family: "computer",
  version: 1,
  kinds: { computer: { prefix: "computer" } },
});
const computers = [
  {
    computerId: ids.computer.generate(),
    name: "Studio",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    computerId: ids.computer.generate(),
    name: "Travel laptop",
    createdAt: 2,
    updatedAt: 2,
  },
];
const first = computers[0];

function computerStory(host: "standalone" | "hub" | "team-off"): Story {
  const Story: Story = () => {
    const [client] = useState(
      () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    const [location, setLocation] = useState<SettingsLocation | null>({
      category: "computers",
    });
    const [readback, setReadback] = useState<boolean | null>(null);
    const [port] = useState(() => {
      const internet = new Map<string, boolean>();
      let selected = first.computerId;
      const shared: OysterComputersPort = {
        list: () => Promise.resolve({ computers, nextOffset: null }),
        create: () => Promise.resolve(first),
        start: () => Promise.resolve(),
        internetAccess: (id) => Promise.resolve(internet.get(id) ?? true),
        setInternetAccess: (id, enabled) => {
          internet.set(id, enabled);
          return Promise.resolve(enabled);
        },
        ...(host === "standalone"
          ? {
              selection: {
                selected: () => Promise.resolve(selected),
                select: (id: string) => {
                  const computer = computers.find(
                    (row) => row.computerId === id,
                  );
                  if (computer === undefined)
                    return Promise.reject(new Error("Unknown Computer"));
                  selected = computer.computerId;
                  return Promise.resolve(computer);
                },
              },
            }
          : {
              egressPolicy: () =>
                Promise.resolve(
                  host === "team-off"
                    ? ("team-disabled" as const)
                    : ("enabled" as const),
                ),
            }),
      };
      return shared;
    });
    return (
      <QueryClientProvider client={client}>
        <div className="tourtois-study" data-computer-host={host}>
          <SystemSettings
            location={location}
            sections={["computers"]}
            onNavigate={setLocation}
            apps={[]}
            appCount={0}
            onAccepted={() => Promise.resolve()}
            desktopSettings={{
              readGill: () => Promise.reject(new Error("Not used")),
              addGill: () => Promise.reject(new Error("Not used")),
              removeGill: () => Promise.reject(new Error("Not used")),
            }}
            desktopConsentReadyAt={0}
            onClosed={() => {
              setLocation(null);
            }}
            restoreFocus={false}
            ports={{
              computers: () => (
                <>
                  <OysterComputers
                    teamId={host}
                    port={port}
                    onChanged={() => {
                      setReadback(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void port
                        .internetAccess(first.computerId)
                        .then(setReadback);
                    }}
                  >
                    Read back Studio
                  </button>
                  <output aria-label="Studio Internet access readback">
                    {readback === null ? "Not read" : readback ? "On" : "Off"}
                  </output>
                </>
              ),
            }}
          />
        </div>
      </QueryClientProvider>
    );
  };
  return Story;
}

export const Standalone = computerStory("standalone");
export const Hub = computerStory("hub");
export const HubTeamOff = computerStory("team-off");
