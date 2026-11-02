import { Card } from "@fungi.computer/caps/components/card";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import {
  IconRadio,
  SwatchRadio,
} from "@fungi.computer/caps/components/icon-radio";
import { RadioGroup } from "@fungi.computer/caps/components/radio-group";
import { Switch } from "@fungi.computer/caps/components/switch";
import { Input } from "@fungi.computer/caps/components/input";
import {
  renderStyles,
  renderStyleLabels,
  renderStyleSchema,
  resolveAppearance,
} from "@fungi.computer/sprite";
import {
  avatarCharacters,
  avatarEnvelopeSchema,
  type Avatar,
} from "@fungi.computer/sprite/avatar";
import { avatarCatalog } from "@fungi.computer/sprite-zdog/catalog";
import {
  memberAvatarSchema,
  deriveAgentAvatar,
  type MemberAvatar,
} from "@fungi.computer/sprite-zdog/avatar";
import { Sigil } from "@fungi.computer/sigils";
import { AvatarPreview } from "./AvatarPreview.js";

const names = { mushroom: "Shiitake", cat: "Cat", burger: "Burger" };
const swatches = [
  ["Rose", "#f98284", "#ffe6c6"],
  ["Peach", "#f6a55c", "#ffe9c9"],
  ["Gold", "#f2d06b", "#fff6d1"],
  ["Leaf", "#9bd47a", "#e6f8d8"],
  ["Mint", "#5fc7b4", "#d9f6ef"],
  ["Sky", "#6aaee8", "#dcefff"],
  ["Lilac", "#9b8cf0", "#ebe6ff"],
  ["Plum", "#e58bd6", "#fbe2f6"],
  ["Clay", "#c98c6a", "#f6e2d4"],
  ["Slate", "#8a8f9c", "#e3e5ea"],
] as const;
const exampleNames = ["Gardener", "Scout", "Ledger", "Pip", "Moss"];

/** Catalog-driven controls; the account owner handles saving and rollback. */
export function AvatarPicker({
  value,
  disabled,
  onChange,
}: {
  value: MemberAvatar;
  disabled: boolean;
  onChange: (next: MemberAvatar) => void;
}) {
  const { avatar, agentColors } = value;
  const catalog = avatarCatalog[avatar.character];
  const resolved = resolveAppearance(catalog.controls, avatar.appearance);
  const change = (next: Partial<Avatar>) => {
    onChange(
      memberAvatarSchema.parse({ ...value, avatar: { ...avatar, ...next } }),
    );
  };
  const primarySlot = catalog.identitySlots[0];
  const colourLabel = avatar.character === "mushroom" ? "Cap colour" : "Colour";
  const selectedSwatch =
    swatches.find(([, primary, secondary]) =>
      catalog.identitySlots.every(
        (slot, index) => resolved[slot] === (index === 0 ? primary : secondary),
      ),
    )?.[0] ?? "";
  return (
    <div className="tourtois-avatar-picker">
      <Card className="tourtois-avatar-preview">
        <AvatarPreview avatar={avatar} className="tourtois-avatar-large" />
        <strong>Your avatar</strong>
        <p>One look for your account, across Teams.</p>
      </Card>
      <fieldset disabled={disabled} className="tourtois-avatar-controls">
        <legend className="sr-only">Customize your avatar</legend>
        <FieldSet
          legend="Character"
          icon={<Sigil name="agent" />}
          layout="columns"
        >
          <RadioGroup
            aria-label="Character"
            className="caps-field-icon-choices"
            orientation="horizontal"
            value={avatar.character}
            onValueChange={(raw) => {
              const character = avatarEnvelopeSchema.shape.character.parse(raw);
              change({ character, appearance: {}, expression: "normal" });
            }}
          >
            {avatarCharacters.map((character) => (
              <IconRadio
                key={character}
                value={character}
                label={names[character]}
                caption={names[character]}
                art="color"
                icon={
                  <AvatarPreview
                    avatar={{
                      ...avatar,
                      character,
                      appearance:
                        character === avatar.character ? avatar.appearance : {},
                      expression: "normal",
                    }}
                    className="tourtois-avatar-key-art"
                  />
                }
              />
            ))}
          </RadioGroup>
        </FieldSet>
        <FieldSet
          legend={colourLabel}
          icon={<Sigil name="prints" />}
          layout="columns"
        >
          <RadioGroup
            aria-label={colourLabel}
            className="caps-field-icon-choices"
            orientation="horizontal"
            value={selectedSwatch}
            onValueChange={(name) => {
              const swatch = swatches.find(([label]) => label === name);
              if (!swatch) return;
              change({
                appearance: {
                  ...avatar.appearance,
                  ...Object.fromEntries(
                    catalog.identitySlots.map((slot, index) => [
                      slot,
                      swatch[index === 0 ? 1 : 2],
                    ]),
                  ),
                },
              });
            }}
          >
            {swatches.map(([name, color]) => (
              <SwatchRadio key={name} value={name} label={name} color={color} />
            ))}
          </RadioGroup>
        </FieldSet>
        <FieldSet
          legend="Custom"
          icon={<Sigil name="write" />}
          layout="columns"
        >
          <div className="tourtois-avatar-custom-colours">
            {catalog.identitySlots.map((slot) => {
              const control = catalog.controls[slot];
              if (control?.type !== "color") return null;
              const label =
                slot === primarySlot ? "Custom colour" : "Accent colour";
              return (
                <Input
                  key={`${avatar.character}:${slot}:${String(resolved[slot])}`}
                  type="color"
                  aria-label={label}
                  title={label}
                  defaultValue={String(resolved[slot])}
                  onBlur={(event) => {
                    if (event.currentTarget.value !== resolved[slot])
                      change({
                        appearance: {
                          ...avatar.appearance,
                          [slot]: event.currentTarget.value,
                        },
                      });
                  }}
                />
              );
            })}
          </div>
        </FieldSet>
        <FieldSet
          legend="Resting face"
          icon={<Sigil name="chat" />}
          layout="columns"
        >
          <RadioGroup
            aria-label="Resting face"
            className="caps-field-icon-choices"
            orientation="horizontal"
            value={avatar.expression}
            onValueChange={(expression) => {
              change({ expression });
            }}
          >
            {catalog.expressions.map((expression) => {
              const label =
                expression.charAt(0).toUpperCase() + expression.slice(1);
              return (
                <IconRadio
                  key={expression}
                  value={expression}
                  label={label}
                  caption={label}
                  art="color"
                  icon={
                    <AvatarPreview
                      avatar={{ ...avatar, expression }}
                      className="tourtois-avatar-key-art"
                    />
                  }
                />
              );
            })}
          </RadioGroup>
        </FieldSet>
        <FieldSet
          legend="Drawing style"
          icon={<Sigil name="generateMedia" />}
          layout="columns"
        >
          <RadioGroup
            aria-label="Drawing style"
            className="caps-field-icon-choices"
            orientation="horizontal"
            value={avatar.renderStyle}
            onValueChange={(raw) => {
              change({ renderStyle: renderStyleSchema.parse(raw) });
            }}
          >
            {renderStyles.map((renderStyle) => (
              <IconRadio
                key={renderStyle}
                value={renderStyle}
                label={renderStyleLabels[renderStyle]}
                caption={renderStyleLabels[renderStyle]}
                art="color"
                icon={
                  <AvatarPreview
                    avatar={{ ...avatar, renderStyle }}
                    className="tourtois-avatar-key-art"
                  />
                }
              />
            ))}
          </RadioGroup>
        </FieldSet>
        <FieldSet
          legend="New Agents"
          icon={<Sigil name="members" />}
          layout="columns"
          description="A preview of your preference for new Agents. Existing Agents keep their look."
        >
          <div className="tourtois-avatar-agents-panel">
            <Field label="Give each Agent its own colour" orientation="inline">
              <Switch
                checked={agentColors === "shift"}
                onCheckedChange={(checked) => {
                  onChange({
                    ...value,
                    agentColors: checked ? "shift" : "keep",
                  });
                }}
              />
            </Field>
            <div className="tourtois-avatar-agents">
              {exampleNames.map((name) => (
                <div key={name}>
                  <AvatarPreview
                    avatar={deriveAgentAvatar(avatar, agentColors, name)}
                    className="tourtois-avatar-agent-preview"
                  />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </div>
        </FieldSet>
      </fieldset>
    </div>
  );
}
