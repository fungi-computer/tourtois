import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useRef, useState } from "react";
import {
  AppAccessConsent,
  type AppAccessRequest,
} from "../src/AppAccessConsent.js";

export default { title: "Desktop / App Consent" } satisfies StoryDefault;

function consent(
  resource: "agents" | "computers" | "both",
  outcome: "ready" | "saving" | "failed" = "ready",
): Story {
  const Story: Story = () => {
    const [open, setOpen] = useState(true);
    const attempted = useRef(false);
    useEffect(() => {
      if (outcome === "ready") return;
      const attempt = () => {
        if (attempted.current) return true;
        const buttons = document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        );
        const allow = [...buttons].find(
          (button) => button.textContent.trim() === "Allow",
        );
        if (!allow || allow.disabled) return false;
        attempted.current = true;
        allow.click();
        return true;
      };
      const observer = new MutationObserver(() => {
        if (attempt()) observer.disconnect();
      });
      if (!attempt())
        observer.observe(document.body, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
      };
    }, []);
    const request: AppAccessRequest = {
      appName:
        resource === "agents"
          ? "Grove"
          : resource === "computers"
            ? "Inkcap"
            : "Prints",
      agents:
        resource === "computers"
          ? []
          : ["agent.list", "agent.manage", "agent.read", "agent.send"],
      computers:
        resource === "agents"
          ? []
          : ["computer.list", "computer.readFile", "computer.writeFile"],
      // A refused save resolves false and declines; only a rejected save keeps
      // the dialog open with its "could not be saved" notice.
      allow: () =>
        outcome === "saving"
          ? new Promise<boolean>(() => undefined)
          : outcome === "failed"
            ? Promise.reject(new Error("Access could not be saved"))
            : Promise.resolve(true),
      settle: () => {
        setOpen(false);
      },
    };
    return <AppAccessConsent request={open ? request : null} />;
  };
  return Story;
}

export const AgentAccess = consent("agents");
export const ComputerAccess = consent("computers");
export const CombinedAccess = consent("both");
export const SavingAccess = consent("both", "saving");
export const FailedAccess = consent("both", "failed");
