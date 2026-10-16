/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import { ResultState } from "@fungi.computer/caps/blocks/result-state";
import "@fungi.computer/parakeet/styles.css";
import "@fungi.computer/caps/fonts.css";

const root = document.getElementById("tourtois-root");
if (!root) throw new Error("Tourtois root is missing");

// Tourtois is a shell, not a framed App: its host composes it into the host's
// own top-level document with escalated permissions. This Release keeps the
// desktop's storage and methods; its page only says where the shell lives.
const reactRoot = createRoot(root);
reactRoot.render(
  <main className="tourtois-shell" data-tourtois-release>
    <ResultState
      title="Tourtois runs as your shell"
      description="Your host serves Tourtois as its trusted home. Open your host's home page to use it."
    />
  </main>,
);
import.meta.hot?.dispose(() => {
  reactRoot.unmount();
});
