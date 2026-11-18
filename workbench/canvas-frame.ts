import * as z from "zod";
import { commandPaletteReservedChordForUserAgent } from "@fungi.computer/nacre/command-host";
import type { AppWindowHost } from "../src/app-windows.js";

/** What the frame may tell the shell: the leader chord it could not handle itself. */
const frameMessageSchema = z.strictObject({
  kind: z.literal("reserved-chord"),
  id: z.string().min(1),
  repeat: z.boolean(),
});

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

/**
 * The neutral Canvas App's own document. It draws a small seed board itself,
 * keeps its own state, and, like every App frame, forwards the leader chord
 * to the shell because keys typed inside a frame never reach the shell page.
 */
function canvasDocument(gill: string | null, chordId: string): string {
  const name = gill === null ? "canvas" : escapeHtml(gill);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<style>
  :root { font: 14px/1.4 system-ui, sans-serif; color: CanvasText; background: Canvas; }
  body { margin: 0; padding: 12px; display: grid; gap: 10px; }
  h1 { font-size: 15px; margin: 0; }
  p { margin: 0; opacity: .7; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  button { font: inherit; text-align: start; width: 100%; cursor: pointer; padding: 8px 10px;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px;
    color: inherit; background: color-mix(in srgb, CanvasText 4%, Canvas); }
  button[aria-pressed="true"] { text-decoration: line-through; opacity: .6;
    background: color-mix(in srgb, #3a9a5b 18%, Canvas); }
  output { font-weight: 600; }
</style></head>
<body data-surface-demo="${name}">
  <h1>Seed board</h1>
  <p>Drawn by Canvas itself (${name}). <output id="count">Done 0 of 3</output></p>
  <ul>
    <li><button type="button" aria-pressed="false">Sow basil</button></li>
    <li><button type="button" aria-pressed="false">Water the ferns</button></li>
    <li><button type="button" aria-pressed="false">Prune the roses</button></li>
  </ul>
  <script>
    const cards = [...document.querySelectorAll("button")];
    for (const card of cards) card.addEventListener("click", () => {
      card.setAttribute("aria-pressed", String(card.getAttribute("aria-pressed") !== "true"));
      const done = cards.filter((item) => item.getAttribute("aria-pressed") === "true").length;
      document.getElementById("count").textContent = "Done " + done + " of " + cards.length;
    });
    addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        parent.postMessage({ kind: "reserved-chord", id: ${JSON.stringify(chordId)}, repeat: event.repeat }, "*");
      }
    });
  </script>
</body></html>`;
}

/**
 * Mount the neutral Canvas App as a real sandboxed iframe: scripts run, but the
 * frame has an opaque origin and reaches the shell only by message, as every
 * App frame does.
 */
export function mountCanvasFrame(
  container: HTMLElement,
  gill: string | null,
  forwardChord: (chord: { id: string; repeat: boolean }) => Promise<void>,
): AppWindowHost {
  const chord = commandPaletteReservedChordForUserAgent(
    globalThis.navigator.userAgent,
  );
  const frame = document.createElement("iframe");
  frame.title = "Canvas";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.srcdoc = canvasDocument(gill, chord.id);
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const message = frameMessageSchema.safeParse(event.data);
    if (!message.success) return;
    // The frame keeps focus until the leader list opens: take it back.
    frame.blur();
    void forwardChord(message.data);
  };
  globalThis.addEventListener("message", onMessage);
  container.append(frame);
  container.dataset.workbenchApp = "canvas";
  return {
    setVisibility: (visibility) => {
      container.dataset.visibility = visibility;
    },
    reconfigure: () => undefined,
    requestClose: () => Promise.resolve(true),
    requestBack: () => Promise.resolve(false),
    requestForward: () => Promise.resolve(false),
    activateNavigation: () => Promise.resolve(false),
    activateStatus: () => Promise.resolve(false),
    dispose: () => {
      globalThis.removeEventListener("message", onMessage);
      frame.remove();
    },
  };
}
