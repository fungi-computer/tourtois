import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AppBar } from "@fungi.computer/caps/blocks/app-bar";
import {
  AvatarSettings,
  MemberAvatarSource,
  OwnSprite,
} from "../src/member-avatar.js";
import { workbenchPorts } from "./host-ports.js";

/** The workbench account port and AppBar composition; the browser proof supplies HTTP. */
export const Account: Story = () => {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <MemberAvatarSource read={workbenchPorts.avatar.read}>
        <main
          style={{
            maxWidth: "60rem",
            margin: "auto",
            padding: "var(--spacing-lg)",
          }}
        >
          <AppBar
            launcher={{
              label: "Open Apps",
              icon: <OwnSprite style={{ width: "100%", height: "100%" }} />,
            }}
            windows={[]}
            launchers={[]}
          />
          <AvatarSettings save={workbenchPorts.avatar.save} />
        </main>
      </MemberAvatarSource>
    </QueryClientProvider>
  );
};
