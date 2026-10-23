import { DataListHeading } from "@fungi.computer/caps/components/data-list";
import { useEffect, useRef, useState } from "react";
import { AppError } from "@fungi.computer/agar";
import type { WorkbenchDesktopSettings } from "@fungi.computer/nacre/workbench";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Select } from "@fungi.computer/caps/components/select";
import type {
  AppDirectoryEntry,
  AppDirectoryGill,
} from "@fungi.computer/nacre/app-directory";

export type AppDesktopSettingsApp = Pick<
  AppDirectoryEntry,
  "surfaceId" | "availability"
> &
  Readonly<{ gills: readonly AppDirectoryGill[] }>;
const sizeLabels = { S: "Small", M: "Medium", L: "Large" };

function GillOption({
  app,
  gill,
  desktop,
  consentReadyAt,
}: {
  app: AppDesktopSettingsApp;
  gill: AppDesktopSettingsApp["gills"][number];
  desktop: WorkbenchDesktopSettings;
  consentReadyAt: number;
}) {
  const sizes = gill.desktop?.sizes ?? [];
  const [size, setSize] = useState(sizes[0] ?? "S");
  const [saved, setSaved] = useState<Awaited<
    ReturnType<WorkbenchDesktopSettings["readGill"]>
  > | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [consentReady, setConsentReady] = useState(
    Date.now() >= consentReadyAt,
  );
  useEffect(() => {
    setConsentReady(Date.now() >= consentReadyAt);
    const timer = window.setTimeout(
      () => {
        setConsentReady(true);
      },
      Math.max(0, consentReadyAt - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [consentReadyAt]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let retired = false;
    setSaved(null);
    void Promise.resolve()
      .then(() =>
        desktop.readGill({ surfaceId: app.surfaceId, gillId: gill.id }),
      )
      .then((value) => {
        if (!retired) setSaved(value);
      })
      .catch((cause: unknown) => {
        console.error("Desktop Gill saved state could not be read", {
          surfaceId: app.surfaceId,
          gillId: gill.id,
          cause,
        });
        if (!retired)
          setError(
            "Your desktop could not be read. Reopen Settings to try again.",
          );
        return { kind: "failed", cause };
      });
    return () => {
      retired = true;
    };
  }, [app.surfaceId, gill.id, desktop]);
  const onDesktop = !!saved?.length;
  const change = async () => {
    if (busy.current || saved === null || Date.now() < consentReadyAt)
      return { kind: "busy" };
    busy.current = true;
    setPending(true);
    setError(null);
    const selection = { surfaceId: app.surfaceId, gillId: gill.id };
    try {
      if (onDesktop) await desktop.removeGill(selection);
      else await desktop.addGill({ ...selection, size });
      setSaved(await desktop.readGill(selection));
      return { kind: "confirmed" };
    } catch (cause) {
      console.error("Desktop Gill member change failed", {
        ...selection,
        cause,
      });
      setError(
        cause instanceof AppError
          ? cause.message
          : "The widget could not be changed. Reopen Settings to try again.",
      );
      // A refusal may mean another tab changed the saved layout. Never keep an optimistic membership flag.
      setSaved(null);
      return { kind: "failed", cause };
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <DataRow style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div>
        <strong>{gill.title}</strong>
        <p>
          {saved === null && !error && "Reading your desktop…"}
          {saved !== null && onDesktop && (
            <span role="status">
              On your desktop ·{" "}
              {saved.map((value) => sizeLabels[value]).join(", ")}
            </span>
          )}
          {saved !== null &&
            !onDesktop &&
            "Choose a size, then add this widget to your desktop."}
          {error ? <span role="alert">{error}</span> : null}
        </p>
      </div>
      <div
        className="flex flex-wrap items-center gap-2"
        style={{ gridRow: 2, gridColumn: "1 / -1" }}
      >
        {!onDesktop ? (
          <div style={{ width: "7rem", flex: "0 0 auto" }}>
            <Select
              aria-label={`Size for ${gill.title}`}
              value={size}
              disabled={pending || saved === null || !consentReady}
              onChange={(event) => {
                const next = sizes.find(
                  (value) => value === event.currentTarget.value,
                );
                if (next) setSize(next);
              }}
            >
              {sizes.map((value) => (
                <option key={value} value={value}>
                  {sizeLabels[value]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={pending || saved === null || !consentReady}
          onClick={(event) => {
            if (event.detail > 1) return;
            void change();
          }}
        >
          {onDesktop ? "Remove from desktop" : "Add to desktop"}
        </Button>
      </div>
    </DataRow>
  );
}

/** Suggestions only: the member chooses, then the admitted dashboard arranges. */
export function AppDesktopSettings({
  app,
  desktop,
  consentReadyAt = 0,
}: {
  app: AppDesktopSettingsApp;
  desktop: WorkbenchDesktopSettings;
  consentReadyAt?: number;
}) {
  const gills =
    app.availability === "available"
      ? app.gills.filter((gill) => gill.desktop)
      : [];
  return (
    <section aria-label="Desktop widgets">
      <DataListHeading level={3}>Desktop widgets</DataListHeading>
      <p>
        Add this App’s widgets to your personal desktop. Your Team default stays
        unchanged.
      </p>
      {gills.length ? (
        <DataList aria-label="Available desktop widgets">
          {gills.map((gill) => (
            <GillOption
              key={gill.id}
              app={app}
              gill={gill}
              desktop={desktop}
              consentReadyAt={consentReadyAt}
            />
          ))}
        </DataList>
      ) : (
        <p>
          {app.availability === "available"
            ? "This App offers no desktop widgets."
            : "This App is unavailable. Its widgets cannot be added."}
        </p>
      )}
    </section>
  );
}
