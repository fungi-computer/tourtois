import { DataListHeading } from "@fungi.computer/caps/components/data-list";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Sigil } from "@fungi.computer/sigils";
import { renderStyleLabels } from "@fungi.computer/sprite";
import type { ReactNode } from "react";
import { OwnSprite, useMemberAvatar } from "./member-avatar.js";
import type { SettingsLocation } from "./settings-routes.js";
import type { TeamAdministrationPort } from "./settings-sections.js";

/** Read-only projections of data the host already loaded. Null is not zero. */
export type SettingsHomeSummary = Readonly<{
  appCount: number | null;
  defaultAppCount: number | null;
  computerCount: number | null;
}>;

function OverviewValue({ children }: { children: ReactNode }) {
  return (
    <span className="caps-action-row-description whitespace-nowrap tabular-nums">
      {children}
    </span>
  );
}

function AvatarOverview({
  onNavigate,
}: {
  onNavigate: (location: SettingsLocation | null) => void;
}) {
  const sprite = useMemberAvatar();
  return (
    <DataRow className="p-0">
      <ActionRow
        aria-label="Avatar"
        icon={
          <OwnSprite
            aria-hidden="true"
            className="tourtois-settings-nav-sprite"
          />
        }
        label="Avatar"
        description="Your character, colours and drawing style."
        trailing={
          <OverviewValue>
            {renderStyleLabels[sprite.avatar.renderStyle]}
          </OverviewValue>
        }
        onClick={() => {
          onNavigate({ category: "avatar" });
        }}
      />
    </DataRow>
  );
}

/** A quiet index, not a second settings editor or a new data reader. */
export function SettingsHome({
  team,
  summary,
  sections,
  desktopOnly = false,
  onNavigate,
}: {
  /** The host's Team administration links, when it has them. */
  team?: TeamAdministrationPort | undefined;
  summary: SettingsHomeSummary;
  /** Destinations this host backs. */
  sections: readonly SettingsLocation["category"][];
  desktopOnly?: boolean;
  onNavigate: (location: SettingsLocation | null) => void;
}) {
  const offers = (category: SettingsLocation["category"]) =>
    sections.includes(category);
  const close = team?.close;
  return (
    <section className="tourtois-settings-content" aria-label="Settings home">
      <DataList density="compact" aria-label="Settings overview">
        {offers("channels") ? (
          <DataRow className="p-0">
            <ActionRow
              aria-label="Website assistant"
              label="Website assistant"
              description="Set up chat on your WordPress site."
              icon={<Sigil name="internet" />}
              onClick={() => {
                onNavigate({ category: "channels" });
              }}
            />
          </DataRow>
        ) : null}
        {offers("selling") ? (
          <DataRow className="p-0">
            <ActionRow
              aria-label="Selling"
              label="Selling"
              description="Sell Apps on the Bazaar."
              icon={<Sigil name="sell" />}
              onClick={() => {
                onNavigate({ category: "selling", appId: null });
              }}
            />
          </DataRow>
        ) : null}
        {offers("avatar") ? <AvatarOverview onNavigate={onNavigate} /> : null}
        {offers("defaults") ? (
          <DataRow className="p-0">
            <ActionRow
              aria-label="Default apps"
              icon={<Sigil name="installApps" />}
              label="Default apps"
              description="Apps for everyday tasks."
              trailing={
                summary.defaultAppCount === null ? null : (
                  <OverviewValue>
                    {String(summary.defaultAppCount) +
                      (summary.defaultAppCount === 1 ? " role" : " roles")}
                  </OverviewValue>
                )
              }
              onClick={() => {
                onNavigate({ category: "defaults" });
              }}
            />
          </DataRow>
        ) : null}
        {team !== undefined ? (
          <DataRow className="p-0">
            <ActionRow
              aria-label="Members and invites"
              icon={<Sigil name="members" />}
              label="Members and invites"
              description="People and invitations."
              onClick={team.openMembers}
            />
          </DataRow>
        ) : null}
        {offers("connectors") ? (
          <DataRow className="p-0">
            <ActionRow
              aria-label="Connectors"
              icon={<Sigil name="read" />}
              label="Connectors"
              description="What Agents can reach."
              onClick={() => {
                onNavigate({
                  category: "connectors",
                  target: { kind: "list" },
                });
              }}
            />
          </DataRow>
        ) : null}
        {offers("computers") ? (
          <DataRow className="p-0">
            <ActionRow
              aria-label="Internet access"
              icon={<Sigil name="internet" />}
              label="Internet access"
              description="Each Computer’s outside access."
              trailing={
                summary.computerCount === null ? null : (
                  <OverviewValue>
                    {String(summary.computerCount) +
                      (summary.computerCount === 1
                        ? " Computer"
                        : " Computers")}
                  </OverviewValue>
                )
              }
              onClick={() => {
                onNavigate({ category: "computers" });
              }}
            />
          </DataRow>
        ) : null}
        {offers("apps") ? (
          <DataRow className="p-0">
            <ActionRow
              aria-label={desktopOnly ? "App desktop" : "App permissions"}
              icon={<Sigil name="restricted" />}
              label={desktopOnly ? "App desktop" : "App permissions"}
              description="Choose an App to review."
              trailing={
                summary.appCount === null ? null : (
                  <OverviewValue>
                    {String(summary.appCount) +
                      (summary.appCount === 1 ? " App" : " Apps")}
                  </OverviewValue>
                )
              }
              onClick={() => {
                onNavigate({
                  category: "apps",
                  appKey: null,
                  section: desktopOnly ? "desktop" : "permissions",
                });
              }}
            />
          </DataRow>
        ) : null}
      </DataList>
      {close !== undefined ? (
        <section className="grid gap-sm" aria-label="Danger zone">
          <DataListHeading level={3} className="tourtois-settings-app-heading">
            Danger zone
          </DataListHeading>
          <DataList density="compact" aria-label="Team closure">
            <DataRow className="p-0">
              <ActionRow
                aria-label="Close Team"
                icon={<Sigil name="restricted" />}
                label="Close Team"
                description={
                  close.available
                    ? "Stop billing and hide this Team"
                    : "Closing is not available yet"
                }
                disabled={!close.available}
                onClick={close.open}
              />
            </DataRow>
          </DataList>
        </section>
      ) : null}
    </section>
  );
}
