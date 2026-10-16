import type { ComponentType } from "react";
import type { AgentMcpServersPort } from "./AgentMcpServers.js";
import type { KeysPort } from "./Keys.js";
import type { MemberAvatarReader, MemberAvatarSave } from "./member-avatar.js";
import {
  settingsLocationSchema,
  type SettingsLocation,
} from "./settings-routes.js";

export type SettingsCategory = SettingsLocation["category"];
export type Navigate = (location: SettingsLocation | null) => void;
export type Accepted = () => Promise<void>;
export type ConnectorsTarget = Extract<
  SettingsLocation,
  { category: "connectors" }
>["target"];

/** Team administration a host links to from the Settings home. */
export type TeamAdministrationPort = Readonly<{
  openMembers: () => void;
  /** Present only when the signed-in member may close the Team. */
  close?: Readonly<{ available: boolean; open: () => void }>;
}>;

/**
 * The Settings sections an embedding host implements. Tourtois renders a
 * section only when its port is present; an absent port is a section this
 * host does not offer, never a mode flag.
 */
export type SettingsSectionPorts = Readonly<{
  /** The person's avatar, read and saved through the host's account. */
  avatar?: Readonly<{ read: MemberAvatarReader; save: MemberAvatarSave }>;
  /** Connectors settings: the host's Agent MCP server custody. */
  agentMcpServers?: AgentMcpServersPort;
  /** A host's own Connectors editor, used when it has no Agent MCP port. */
  connectors?: ComponentType<{
    target: ConnectorsTarget;
    onNavigate: Navigate;
  }>;
  /** Each Computer's outside access. */
  computers?: ComponentType;
  /** Keys settings: the host's owner-direct Keys custody. */
  keys?: KeysPort;
  /** The Team's role defaults. */
  defaults?: ComponentType<{ onAccepted: Accepted }>;
  /** Channels and website assistants. */
  channels?: ComponentType;
  /** Selling Apps; a host offers it only to members who may sell. */
  selling?: ComponentType<{ appId: string | null; onNavigate: Navigate }>;
  /** An App's Permissions tab. Without it, Apps show their Desktop tab. */
  appPermissions?: ComponentType<{
    selectedKey: string | null;
    onAccepted: Accepted;
  }>;
  /** An App's Advanced tab, kept mounted so its drafts survive tab changes. */
  appAdvanced?: ComponentType<{
    selectedKey: string | null;
    visible: boolean;
    onNavigate: Navigate;
    onAccepted: Accepted;
  }>;
  team?: TeamAdministrationPort;
  /** Counts the host already loaded for the Settings home. Null is not zero. */
  summary?: Readonly<{
    defaultAppCount: number | null;
    computerCount: number | null;
  }>;
}>;

const categories: readonly SettingsCategory[] =
  settingsLocationSchema.options.map((option) => option.shape.category.value);

/** Categories within the host's ceiling that a port actually backs. */
export function offeredSettings(
  ceiling: readonly SettingsCategory[] | undefined,
  ports: SettingsSectionPorts,
): readonly SettingsCategory[] {
  const backed = {
    home: true,
    apps: true,
    avatar: ports.avatar !== undefined,
    connectors:
      ports.agentMcpServers !== undefined || ports.connectors !== undefined,
    computers: ports.computers !== undefined,
    keys: ports.keys !== undefined,
    defaults: ports.defaults !== undefined,
    channels: ports.channels !== undefined,
    selling: ports.selling !== undefined,
  } satisfies Readonly<Record<SettingsCategory, boolean>>;
  return categories.filter(
    (category) =>
      backed[category] && (ceiling === undefined || ceiling.includes(category)),
  );
}
