import { useState } from "react";
import { AppGrid } from "@fungi.computer/caps/blocks/launcher-grid";
import type { AppGridItem } from "@fungi.computer/caps/blocks/launcher-grid";
import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Select } from "@fungi.computer/caps/components/select";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { Sigil } from "@fungi.computer/sigils";
import type { AppGillDesktopSize } from "@fungi.computer/gills";
import { ExternalLink } from "lucide-react";
import type { InstallingApp } from "@fungi.computer/nacre/workbench-directory";
import { SetupNotice } from "@fungi.computer/caps/blocks/setup-notice";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { Badge } from "@fungi.computer/caps/components/badge";
import { Loader } from "@fungi.computer/caps/components/loader";
import { starterItem } from "./starter-item.js";
import { GillFrame } from "./gill-frame.js";
import { FirstRunWelcome, useWelcome } from "./welcome.js";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";

const installDocs = "https://docs.fungi.computer/oyster-quickstart/";

/** Trusted shell Gill. Defaults to the same complete launchable set/order as the AppBar. */
export function LauncherGill({
  items,
  size = "M",
  onAllApps,
  loading = false,
  unavailable = false,
  onRetry,
  warnings = [],
  preferences,
  onPreference,
  editHandle,
  onContentHeight,
  installing = [],
  onRetryInstall,
}: {
  items: readonly AppBarItem[];
  size?: AppGillDesktopSize;
  onAllApps: () => void;
  loading?: boolean;
  unavailable?: boolean;
  onRetry?: () => void;
  warnings?: readonly AppGridItem[];
  preferences: Readonly<{
    pinned: readonly string[];
    hidden: readonly string[];
  }>;
  onPreference: (id: string, state: "Pinned" | "Shown" | "Hidden") => void;
  onContentHeight?: ((height: number) => void) | undefined;
  editHandle?: React.ReactNode;
  /** Starter Apps a trial is still setting up, or could not set up. */
  installing?: readonly InstallingApp[];
  /** Ask the trial to try one failed App again. */
  onRetryInstall?: ((installationId: string) => Promise<void>) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const welcome = useWelcome();
  const stateFor = (id: string) =>
    preferences.hidden.includes(id)
      ? "Hidden"
      : preferences.pinned.includes(id)
        ? "Pinned"
        : "Shown";
  const shown = items.filter((item) => stateFor(item.id) !== "Hidden");
  const ordered = [
    ...shown.filter((item) => stateFor(item.id) === "Pinned"),
    ...shown.filter((item) => stateFor(item.id) !== "Pinned"),
  ];
  const needsRuntime = new Set(
    installing.flatMap((entry) => {
      const found =
        entry.state === "needs-runtime"
          ? starterItem(items, entry.installationId)
          : undefined;
      return found ? [found.id] : [];
    }),
  );
  const tiles: AppGridItem[] = ordered.map((item) => {
    const tile: AppGridItem = {
      id: item.id,
      label: item.label,
      icon: item.icon,
      onSelect: item.onSelect,
    };
    return needsRuntime.has(item.id)
      ? {
          ...tile,
          muted: true,
          status: (
            <Badge
              tone="warning"
              variant="quiet"
              size="sm"
              className="whitespace-nowrap"
              title={`${item.label} needs a Computer runtime this trial doesn't have`}
            >
              Needs Computer
            </Badge>
          ),
        }
      : tile;
  });
  const pendingTiles: AppGridItem[] = installing
    .filter((entry) => entry.state === "installing")
    .map((entry) => ({
      id: `installing:${entry.installationId}`,
      label: entry.displayName,
      icon: <Loader decorative variant="square" size="md" />,
      muted: true,
      disabled: true,
      status: (
        <Badge
          tone="neutral"
          variant="quiet"
          size="sm"
          className="whitespace-nowrap"
          title={`Getting ${entry.displayName} ready…`}
        >
          Getting ready
        </Badge>
      ),
      onSelect: () => undefined,
    }));
  const ready = !loading && !unavailable;
  return (
    <GillFrame
      title="Launcher"
      size={size}
      onContentHeight={onContentHeight}
      editHandle={
        editHandle ?? (
          <Button
            size="xs"
            variant="outline"
            aria-expanded={editing}
            onClick={() => {
              setEditing(!editing);
            }}
          >
            {editing ? "Done" : "Edit launcher"}
          </Button>
        )
      }
    >
      {loading ? <LoadingState message="Loading Apps…" /> : null}
      {unavailable ? (
        <FailureLine
          role="alert"
          message="App directory unavailable."
          {...(onRetry ? { onRetry } : {})}
        />
      ) : null}
      {ready ? (
        <>
          {welcome.visible && shown.length > 0 ? (
            <FirstRunWelcome items={items} onDismiss={welcome.dismiss} />
          ) : null}
          {items.length === 0 ? (
            <EmptyState
              variant="hint"
              title="No Apps available"
              description="Open All Apps to find what you can use."
              primaryAction={{ label: "Open All Apps", onSelect: onAllApps }}
            />
          ) : null}
          {items.length > 0 && shown.length === 0 && !editing ? (
            <EmptyState
              variant="quiet"
              title="Choose the Apps you want here"
              description="Your Apps are hidden from the launcher."
              primaryAction={{
                label: "Show Apps",
                onSelect: () => {
                  setEditing(true);
                },
              }}
            />
          ) : null}
          {items.length > 0 ||
          pendingTiles.length > 0 ||
          warnings.length > 0 ? (
            <AppGrid
              aria-label="Apps"
              items={[
                ...tiles,
                ...pendingTiles,
                ...warnings,
                {
                  id: "all-apps",
                  label: "All Apps",
                  icon: <Sigil name="allApps" />,
                  onSelect: onAllApps,
                },
              ]}
              size="lg"
            />
          ) : null}
          <div className="tourtois-install-notes">
            {installing.map((entry) =>
              entry.state === "installing" ? null : (
                <InstallNote
                  key={entry.installationId}
                  entry={entry}
                  onRetry={onRetryInstall}
                  onOpen={starterItem(items, entry.installationId)?.onSelect}
                />
              ),
            )}
          </div>
          <div className="tourtois-launcher-more">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                window.open(installDocs, "_blank", "noopener,noreferrer");
              }}
            >
              More Apps
              <ExternalLink aria-hidden="true" size={14} />
            </Button>
          </div>
          {editing ? (
            <DataList aria-label="Launcher preferences">
              {items.map((item) => (
                <DataRow key={item.id}>
                  <div className="tourtois-launcher-preference">
                    <span
                      aria-hidden="true"
                      className="grid size-6 place-items-center [&_svg]:size-full"
                    >
                      {item.icon ?? <Sigil name="installApps" />}
                    </span>
                    <div className="tourtois-launcher-preference-identity">
                      <span>{item.label}</span>
                    </div>
                    <Select
                      aria-label={`Launcher state for ${item.label}`}
                      value={stateFor(item.id)}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (
                          value !== "Pinned" &&
                          value !== "Shown" &&
                          value !== "Hidden"
                        )
                          return;
                        onPreference(item.id, value);
                      }}
                    >
                      <option value="Shown">Shown</option>
                      <option value="Pinned">Pinned</option>
                      <option value="Hidden">Hidden</option>
                    </Select>
                  </div>
                </DataRow>
              ))}
            </DataList>
          ) : null}
        </>
      ) : null}
    </GillFrame>
  );
}

/** A starter App the trial could not set up, or that needs what the trial lacks. */
function InstallNote({
  entry,
  onRetry,
  onOpen,
}: {
  entry: InstallingApp;
  onRetry: ((installationId: string) => Promise<void>) | undefined;
  onOpen: (() => void) | undefined;
}) {
  const [asked, setAsked] = useState(false);
  if (entry.state === "needs-runtime")
    return onOpen ? (
      <SetupNotice
        variant="inline"
        need={`${entry.displayName} needs a Computer`}
        cause={
          entry.reason?.message ??
          `${entry.displayName} is installed, but it needs a Computer runtime this trial doesn't have.`
        }
        fix={{ label: `Open ${entry.displayName}`, onSelect: onOpen }}
      />
    ) : null;
  return (
    <FailureLine
      message={`${entry.displayName} couldn't be installed${
        entry.reason ? `: ${entry.reason.message}` : "."
      }`}
      retryLabel={asked ? "Retrying…" : "Retry"}
      {...(onRetry && !asked
        ? {
            onRetry: () => {
              setAsked(true);
              void onRetry(entry.installationId).catch((cause: unknown) => {
                console.error("Retry was not accepted", cause);
                setAsked(false);
              });
            },
          }
        : {})}
    />
  );
}
