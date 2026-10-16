import { Card } from "@fungi.computer/caps/components/card";
import { DataListHeading } from "@fungi.computer/caps/components/data-list";
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupCard,
} from "@fungi.computer/caps/components/radio-group";
import { Switch } from "@fungi.computer/caps/components/switch";
import { Input } from "@fungi.computer/caps/components/input";
import { Field } from "@fungi.computer/caps/components/field";
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
        <section aria-labelledby="avatar-character">
          <DataListHeading level={3} id="avatar-character">
            Character
          </DataListHeading>
          <RadioGroup
            aria-labelledby="avatar-character"
            className="tourtois-avatar-characters"
            orientation="horizontal"
            value={avatar.character}
            onValueChange={(raw) => {
              const character = avatarEnvelopeSchema.shape.character.parse(raw);
              change({ character, appearance: {}, expression: "normal" });
            }}
          >
            {avatarCharacters.map((character) => (
              <RadioGroupCard
                key={character}
                value={character}
                title={names[character]}
                description={
                  <AvatarPreview
                    avatar={{
                      ...avatar,
                      character,
                      appearance:
                        character === avatar.character ? avatar.appearance : {},
                      expression: "normal",
                    }}
                    className="tourtois-avatar-character-preview"
                  />
                }
              />
            ))}
          </RadioGroup>
        </section>
        <section aria-labelledby="avatar-colours">
          <DataListHeading level={3} id="avatar-colours">
            {avatar.character === "mushroom" ? "Cap colour" : "Colour"}
          </DataListHeading>
          <RadioGroup
            aria-labelledby="avatar-colours"
            className="tourtois-avatar-swatches"
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
              <label
                key={name}
                title={name}
                className="tourtois-avatar-swatch"
                style={{ backgroundColor: color }}
              >
                <RadioGroupItem value={name} aria-label={name} />
              </label>
            ))}
          </RadioGroup>
          <div className="tourtois-avatar-custom-colours">
            {catalog.identitySlots.map((slot) => {
              const control = catalog.controls[slot];
              if (control?.type !== "color") return null;
              return (
                <Field
                  key={`${avatar.character}:${slot}:${String(resolved[slot])}`}
                  label={
                    slot === primarySlot ? "Custom colour" : "Accent colour"
                  }
                >
                  <Input
                    type="color"
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
                </Field>
              );
            })}
          </div>
        </section>
        <section aria-labelledby="avatar-expression">
          <DataListHeading level={3} id="avatar-expression">
            Resting face
          </DataListHeading>
          <RadioGroup
            aria-labelledby="avatar-expression"
            className="tourtois-avatar-faces"
            orientation="horizontal"
            value={avatar.expression}
            onValueChange={(expression) => {
              change({ expression });
            }}
          >
            {catalog.expressions.map((expression) => (
              <RadioGroupCard
                key={expression}
                value={expression}
                title={expression.charAt(0).toUpperCase() + expression.slice(1)}
              />
            ))}
          </RadioGroup>
        </section>
        <section aria-labelledby="avatar-style">
          <DataListHeading level={3} id="avatar-style">
            Drawing style
          </DataListHeading>
          <RadioGroup
            aria-labelledby="avatar-style"
            className="tourtois-sprite-styles"
            orientation="horizontal"
            value={avatar.renderStyle}
            onValueChange={(raw) => {
              change({ renderStyle: renderStyleSchema.parse(raw) });
            }}
          >
            {renderStyles.map((renderStyle) => (
              <RadioGroupCard
                key={renderStyle}
                value={renderStyle}
                title={renderStyleLabels[renderStyle]}
                description={
                  <AvatarPreview
                    avatar={{ ...avatar, renderStyle }}
                    className="tourtois-sprite-style-preview"
                  />
                }
              />
            ))}
          </RadioGroup>
        </section>
        <section aria-labelledby="avatar-agents">
          <DataListHeading level={3} id="avatar-agents">
            Your new Agents
          </DataListHeading>
          <Field label="Give each Agent its own colour">
            <Switch
              checked={agentColors === "shift"}
              onCheckedChange={(checked) => {
                onChange({ ...value, agentColors: checked ? "shift" : "keep" });
              }}
            />
          </Field>
          <p className="tourtois-settings-lede">
            A preview of your preference for new Agents. Existing Agents keep
            their look.
          </p>
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
        </section>
      </fieldset>
    </div>
  );
}
