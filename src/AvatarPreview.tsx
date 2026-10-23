import { ShiitakeAvatar } from "@fungi.computer/parakeet/agent-head";
import type { SpriteService } from "@fungi.computer/sprite";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { createContext, useContext, type CSSProperties } from "react";

/**
 * Replaces the shared Shiitake sprite service for every preview below it;
 * a host or test that must not draw live sprites supplies a fake. Absent, previews
 * use Parakeet's shared service.
 */
export const AvatarSpriteServiceContext = createContext<
  SpriteService | undefined
>(undefined);

/** Member and picker previews use Parakeet's shared avatar mapper and service. */
export function AvatarPreview({
  avatar,
  activity = "idle",
  expression = avatar.expression,
  className,
  style,
}: {
  avatar: Avatar;
  activity?: string;
  expression?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const service = useContext(AvatarSpriteServiceContext);
  return (
    <span
      className={className}
      style={{ display: "block", ...style }}
      aria-hidden="true"
    >
      <ShiitakeAvatar
        avatar={avatar}
        className="h-full w-full"
        {...(service ? { service } : {})}
        state={{ activity, expression }}
      />
    </span>
  );
}
