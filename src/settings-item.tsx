import type { ReactNode } from "react";

/**
 * One object on a settings page, the Prints details rhythm: a 16px Sigil and
 * its name, quiet detail under it, and its compact keys opposite. Computers,
 * keys and connected servers all use this line.
 */
export function SettingsItem({
  icon,
  title,
  detail,
  actions,
}: {
  /** A Sigil at 16px; decorative, the title names the item. */
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** Compact keycaps or a status dot. */
  actions?: ReactNode;
}) {
  return (
    <div className="tourtois-settings-item">
      <div className="tourtois-settings-item-copy">
        <h3 className="tourtois-settings-item-title">
          <span className="tourtois-settings-item-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="tourtois-settings-item-name">{title}</span>
        </h3>
        {detail ? (
          <div className="tourtois-settings-item-detail">{detail}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="tourtois-settings-item-keys">{actions}</div>
      ) : null}
    </div>
  );
}
