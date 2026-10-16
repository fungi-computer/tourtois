import type { StoryDefault } from "@ladle/react";
import { useState, type ChangeEvent } from "react";
import { useForm } from "@tanstack/react-form";
import { Wizard } from "@fungi.computer/caps/components/wizard";
import { Field } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Button } from "@fungi.computer/caps/components/button";

export default { title: "Forms / Wizard" } satisfies StoryDefault;

/** One TanStack form retains values while Caps presents controlled steps. */
export function WithTanStackForm() {
  const [step, setStep] = useState("name");
  const [saved, setSaved] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { name: "Weekend ideas", folder: "/projects" },
    onSubmit: ({ value }) => {
      setSaved(`${value.name} · ${value.folder}`);
    },
  });
  return (
    <form
      className="max-w-[32rem] p-lg"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Wizard
        current={step}
        onStepChange={setStep}
        steps={[
          {
            id: "name",
            title: "Name",
            content: (
              <form.Field name="name">
                {(field) => (
                  <Field label="Project name">
                    <Input
                      value={field.state.value}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        field.handleChange(event.target.value);
                      }}
                    />
                  </Field>
                )}
              </form.Field>
            ),
          },
          {
            id: "folder",
            title: "Folder",
            content: (
              <form.Field name="folder">
                {(field) => (
                  <Field label="Folder">
                    <Input
                      value={field.state.value}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        field.handleChange(event.target.value);
                      }}
                    />
                  </Field>
                )}
              </form.Field>
            ),
          },
        ]}
        actions={
          <Button type="submit" size="sm">
            Save
          </Button>
        }
      />
      <p className="mt-sm text-sm" role="status">
        {saved}
      </p>
    </form>
  );
}
