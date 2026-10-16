import type { AppBarItem } from "@fungi.computer/caps/blocks/app-bar";
import { Badge } from "@fungi.computer/caps/components/badge";
import { useEffect, useState, type ReactNode } from "react";
import {
  decodeDeclaredGillResponse,
  type GillResponse,
} from "@fungi.computer/gills";
import type { TeamWorkbenchHostHandle } from "@fungi.computer/oyster/shell/workbench";
import type {
  AppDeclaredGill,
  AppGillDesktopSize,
} from "@fungi.computer/gills";
type RowV1 = GillResponse["rows"][number];
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { Button } from "@fungi.computer/caps/components/button";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { Status } from "@fungi.computer/caps/components/status";
import { GillFrame } from "./gill-frame.js";

export type DesktopGillTransport = Pick<
  TeamWorkbenchHostHandle,
  "requestGill" | "watchGillChanges"
>;
function detail(row: RowV1): ReactNode {
  return row.tone === "error" && row.detail ? (
    <Badge size="sm" variant="quiet" tone="error">
      {row.detail}
    </Badge>
  ) : (
    row.detail
  );
}
function rowStatus(row: RowV1): ReactNode {
  return row.status ? (
    <Status size="compact" label={row.status.label} tone={row.status.tone} />
  ) : null;
}
/** The host admits reads; opening a row navigates inside its App. */
export function RowGill({
  surfaceId,
  appHeader,
  declaration,
  params,
  size,
  paused,
  transport,
  onOpen,
  onConfigure,
  launch,
  editHandle,
  onContentHeight,
}: {
  surfaceId: string;
  appHeader: Readonly<{ name: string; icon: ReactNode }>;
  declaration: AppDeclaredGill;
  params?: Readonly<Record<string, string>> | undefined;
  size: AppGillDesktopSize;
  paused: boolean;
  transport: DesktopGillTransport;
  onOpen: (target: NonNullable<GillResponse["rows"][number]["open"]>) => void;
  onConfigure?: (() => void) | undefined;
  launch?: Pick<AppBarItem, "label" | "onSelect"> | undefined;
  onContentHeight?: ((height: number) => void) | undefined;
  editHandle?: ReactNode;
}) {
  const [response, setResponse] = useState<GillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<readonly (string | undefined)[]>([
    undefined,
  ]);
  const after = pages[pages.length - 1];
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (paused) return;
    let closed = false;
    const retired = () => closed;
    let stop: (() => Promise<void>) | undefined;
    let loading: Promise<void> | undefined;
    let dirty = false;
    let permanentlyUnavailable = false;
    const refresh = (): Promise<void> => {
      if (permanentlyUnavailable || retired()) return Promise.resolve();
      dirty = true;
      if (loading) return loading;
      loading = (async () => {
        while (dirty && !retired() && !permanentlyUnavailable) {
          dirty = false;
          const reply = await transport.requestGill({
            surfaceId,
            viewId: declaration.id,
            params,
            after,
          });
          if ("options" in reply)
            throw new Error("Expected Gill rows, received options");
          const next = decodeDeclaredGillResponse(reply, declaration);
          if (retired()) return;
          setResponse(next);
          setError(null);
          if (
            next.state === "error" &&
            next.reason === "exec_isolation_required"
          ) {
            permanentlyUnavailable = true;
            const close = stop;
            stop = undefined;
            await close?.().catch((cause: unknown) => {
              console.error("Desktop Gill observation close failed", {
                surfaceId,
                viewId: declaration.id,
                cause,
              });
            });
          }
        }
      })()
        .catch((cause: unknown) => {
          console.error("Desktop Gill read failed", {
            surfaceId,
            viewId: declaration.id,
            cause,
          });
          if (!retired()) setError("This widget could not be refreshed.");
        })
        .finally(() => {
          loading = undefined;
        });
      return loading;
    };
    void (async () => {
      const watch = await transport.watchGillChanges(
        { surfaceId, viewId: declaration.id },
        refresh,
      );
      if (retired()) {
        await watch.close();
        return;
      }
      stop = () => watch.close();
      await refresh();
    })().catch((cause: unknown) => {
      console.error("Desktop Gill observation failed", {
        surfaceId,
        viewId: declaration.id,
        cause,
      });
      if (!retired()) setError("This widget is unavailable.");
    });
    return () => {
      closed = true;
      void stop?.().catch((cause: unknown) => {
        console.error("Desktop Gill observation close failed", {
          surfaceId,
          viewId: declaration.id,
          cause,
        });
      });
    };
  }, [after, declaration, params, paused, retry, surfaceId, transport]);
  const recovery = response?.state === "error" ? response.recovery : undefined;
  const recoveryParam =
    recovery?.kind === "configure"
      ? declaration.params?.find((param) => param.key === recovery.param)
      : undefined;
  const opensApp =
    recovery?.kind === "open" ||
    (recovery === undefined &&
      response?.state === "error" &&
      response.reason === "exec_isolation_required");
  return (
    <GillFrame
      title={response?.title ?? declaration.title}
      appHeader={appHeader}
      size={size}
      onContentHeight={onContentHeight}
      editHandle={editHandle}
    >
      {error ? (
        <p role="alert">
          {error}{" "}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </p>
      ) : null}
      {!response && !error ? (
        <p role="status">Loading {declaration.title}…</p>
      ) : null}
      {response?.state === "error" ? (
        <div>
          <p role="alert">
            {response.reason === "exec_isolation_required" && launch
              ? `${response.title} isn't available on this preview. Open ${launch.label}.`
              : response.error}
          </p>
          {recoveryParam && onConfigure ? (
            <Button size="sm" variant="primary" onClick={onConfigure}>
              Choose {recoveryParam.label}
            </Button>
          ) : null}
          {opensApp && launch ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                launch.onSelect();
              }}
            >
              Open {launch.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      {response?.state === "empty" ? (
        <EmptyState
          variant="hint"
          title={`No ${response.title} items yet`}
          description={`${response.title} items appear here when available.`}
        />
      ) : null}
      {response?.state === "full" ? (
        <DataList aria-label={`${response.title} rows`} density="compact">
          {response.rows.map((row) => (
            <DataRow key={row.id}>
              {row.open ? (
                <ActionRow
                  density="compact"
                  label={row.title}
                  description={detail(row)}
                  trailing={rowStatus(row)}
                  aria-label={`Open: ${row.title}`}
                  onClick={() => {
                    if (row.open) onOpen(row.open);
                  }}
                />
              ) : (
                <>
                  <div className="tourtois-gill-text-row">
                    <span>{row.title}</span>
                    {row.detail ? <small>{detail(row)}</small> : null}
                  </div>
                  {rowStatus(row)}
                </>
              )}
            </DataRow>
          ))}
        </DataList>
      ) : null}
      {pages.length > 1 ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={paused}
          onClick={() => {
            setPages((current) => current.slice(0, -1));
          }}
        >
          Previous page
        </Button>
      ) : null}
      {response && response.state !== "error" && response.next !== undefined ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={paused}
          onClick={() => {
            setPages((current) => [...current, response.next]);
          }}
        >
          Next page
        </Button>
      ) : null}
    </GillFrame>
  );
}
