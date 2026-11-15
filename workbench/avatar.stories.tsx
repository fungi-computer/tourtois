import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@fungi.computer/caps/components/toaster";
import { AppBar } from "@fungi.computer/caps/blocks/app-bar";
import {
  AvatarSettings,
  MemberAvatarSource,
  OwnSprite,
} from "../src/member-avatar.js";
import { WORKBENCH_NOTICES } from "../src/app-toast.js";
import { workbenchPorts } from "./host-ports.js";

/** The workbench account port and AppBar composition; the browser proof supplies HTTP. */
export const Account: Story = () => {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Toaster
        id={WORKBENCH_NOTICES}
        position="bottom-right"
        offset={24}
        mobileOffset={24}
        closeButton
      />
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
