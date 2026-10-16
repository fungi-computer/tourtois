import type { ReactNode } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { Select } from "@fungi.computer/caps/components/select";
import { AppIcon } from "./app-icon.js";
import {
  addressKey,
  type AppAddress,
} from "@fungi.computer/oyster/shell/app-directory";
import { OwnSprite } from "./member-avatar.js";
import type { SettingsLocation } from "./settings-routes.js";

export type NavigationApp = Readonly<{
  address: AppAddress;
  appId: string;
  displayName?: string | undefined;
  icon?: string | null | undefined;
  roles: readonly string[];
}>;

type NavigationOption = Readonly<{
  value: string;
  label: string;
  location: SettingsLocation;
  icon?: ReactNode;
}>;

type NavigationGroup = Readonly<{
  label: string;
  /**
   * The dialog header already reads "System Settings"; a rail heading for a
   * single-item "Settings" group would repeat that as a third title. The
   * `<select>` optgroup still uses `label` for its own accessible grouping.
   */
  showRailLabel?: boolean;
  options: readonly NavigationOption[];
}>;

export function SettingsNavigation({
  location,
  apps,
  sections,
  desktopOnly = false,
  onNavigate,
}: {
  location: SettingsLocation | null;
  apps: readonly NavigationApp[];
  /** Only destinations backed by the embedding host. */
  sections: readonly SettingsLocation["category"][];
  desktopOnly?: boolean;
  onNavigate: (location: SettingsLocation | null) => void;
}) {
  const groups = navigationGroups(apps, sections, desktopOnly);
  const selectedValue = navigationValue(location, apps);
  const selectOption = (value: string) => {
    const option = groups
      .flatMap(({ options }) => options)
      .find((candidate) => candidate.value === value);
    if (option) onNavigate(option.location);
  };

  return (
    <>
      <div className="tourtois-settings-mobile-select">
        <Select
          aria-label="Settings category"
          value={selectedValue}
          onChange={(event) => {
            selectOption(event.currentTarget.value);
          }}
        >
          <option value="" disabled>
            Choose a settings category
          </option>
          {groups.map(({ label, options }) => (
            <optgroup key={label} label={label}>
              {options.map(({ value, label: optionLabel }) => (
                <option key={value} value={value}>
                  {optionLabel}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <nav className="tourtois-settings-nav" aria-label="Settings categories">
        {groups.map(({ label, showRailLabel, options }) => (
          <div key={label} className="tourtois-settings-nav-group">
            {showRailLabel === false ? null : (
              <span className="caps-eyebrow tourtois-settings-nav-label">
                {label}
              </span>
            )}
            {options.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant="ghost"
                className={
                  option.value === selectedValue
                    ? "bg-base-300 text-base-content"
                    : undefined
                }
                aria-pressed={option.value === selectedValue}
                onClick={() => {
                  onNavigate(option.location);
                }}
              >
                {option.icon}
                <span className="tourtois-settings-nav-item-label">
                  {option.label}
                </span>
              </Button>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

function navigationGroups(
  apps: readonly NavigationApp[],
  sections: readonly SettingsLocation["category"][],
  desktopOnly: boolean,
): readonly NavigationGroup[] {
  const groups: readonly NavigationGroup[] = [
    {
      label: "Settings",
      // The dialog header already reads "System Settings"; don't repeat it
      // as a rail heading above this single "Settings home" item.
      showRailLabel: false,
      options: [
        {
          value: "home",
          label: "Settings home",
          location: { category: "home" },
        },
      ],
    },
    {
      label: "You",
      options: [
        {
          value: "avatar",
          label: "Avatar",
          location: { category: "avatar" },
          icon: (
            <OwnSprite
              aria-hidden="true"
              className="tourtois-settings-nav-sprite"
            />
          ),
        },
      ],
    },
    {
      label: "Apps",
      options: [
        {
          value: "defaults",
          label: "Default Apps",
          location: { category: "defaults" },
        },
        {
          value: "app-permissions",
          label: desktopOnly ? "App desktop" : "App permissions",
          location: {
            category: "apps",
            appKey: null,
            section: desktopOnly ? "desktop" : "permissions",
          },
        },
        ...apps.map((app) => {
          const key = addressKey(app.address);
          return {
            value: `app:${key}`,
            label: app.displayName ?? app.appId,
            location: {
              category: "apps" as const,
              appKey: key,
              section: desktopOnly
                ? ("desktop" as const)
                : ("permissions" as const),
            },
            icon: <AppIcon roles={app.roles} icon={app.icon} />,
          };
        }),
      ],
    },
    {
      label: "Team",
      options: [
        {
          value: "selling",
          label: "Selling",
          location: { category: "selling", appId: null },
        },
        {
          value: "channels",
          label: "Channels",
          location: { category: "channels" },
        },
        {
          value: "connectors",
          label: "Connectors",
          location: { category: "connectors", target: { kind: "list" } },
        },
        {
          value: "computers",
          label: "Internet access",
          location: { category: "computers" },
        },
        {
          value: "keys",
          label: "Keys",
          location: { category: "keys" },
        },
      ],
    },
  ];
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) =>
        sections.includes(option.location.category),
      ),
    }))
    .filter((group) => group.options.length > 0);
}

function navigationValue(
  location: SettingsLocation | null,
  apps: readonly NavigationApp[],
): string {
  switch (location?.category) {
    case "selling":
      return "selling";
    case "home":
      return "home";
    case "avatar":
      return "avatar";
    case "defaults":
      return "defaults";
    case "connectors":
      return "connectors";
    case "computers":
      return "computers";
    case "keys":
      return "keys";
    case "channels":
      return "channels";
    case "apps":
      return location.appKey === null
        ? "app-permissions"
        : appNavigationValue(location.appKey, apps);
    default:
      return "home";
  }
}

function appNavigationValue(
  appKey: string | null,
  apps: readonly NavigationApp[],
): string {
  if (!appKey || !apps.some((app) => addressKey(app.address) === appKey))
    return "";
  return `app:${appKey}`;
}
