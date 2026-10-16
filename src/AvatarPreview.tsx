import { ShiitakeAvatar } from "@fungi.computer/parakeet/agent-head";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import type { CSSProperties } from "react";

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
  return (
    <span
      className={className}
      style={{ display: "block", ...style }}
      aria-hidden="true"
    >
      <ShiitakeAvatar
        avatar={avatar}
        className="h-full w-full"
        state={{ activity, expression }}
      />
    </span>
  );
}
