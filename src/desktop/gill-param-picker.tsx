import type { GillRequest } from "@fungi.computer/gills";
import { useEffect, useRef, useState } from "react";
import {
  type AppGillParam,
  type GillOptionsResponse,
} from "@fungi.computer/gills";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { Field, Form, FormFooter } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import { validDesktopGillParams, type DesktopGill } from "../desktop-layout.js";
import type { DesktopGillTransport } from "./row-gill.js";

/** Chooses placement context through the Gill's own declaration and host inventory. */
export function GillParamPicker({
  gill,
  initialParams = {},
  computers,
  transport,
  editing,
  onSave,
  onClose,
}: {
  gill: DesktopGill;
  initialParams?: Readonly<Record<string, string>> | undefined;
  computers: readonly Readonly<{ computerId: string; name: string }>[];
  transport: DesktopGillTransport;
  editing: boolean;
  onSave: (params: Record<string, string>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    ...initialParams,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const declared = gill.params ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="tourtois-gill-param-dialog">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Configure" : "Place"} {gill.title}
          </DialogTitle>
        </DialogHeader>
        <Form
          busy={saving}
          onSubmit={(event) => {
            event.preventDefault();
            if (!validDesktopGillParams(values, declared)) return;
            setSaving(true);
            void onSave(values)
              .then((accepted) => {
                if (accepted) onClose();
                else setError("Your widget could not be saved. Try again.");
              })
              .catch((cause: unknown) => {
                console.error("Gill placement could not be confirmed", cause);
                setError("Your widget placement could not be confirmed.");
              })
              .finally(() => {
                setSaving(false);
              });
          }}
        >
          {declared.map((param, index) => {
            const previous = declared.slice(0, index);
            const context = Object.fromEntries(
              previous.flatMap((param) => {
                const value = values[param.key];
                return value ? [[param.key, value]] : [];
              }),
            );
            return (
              <ParameterChoice
                key={`${param.key}:${JSON.stringify(context)}`}
                surfaceId={gill.surfaceId}
                viewId={gill.gillId}
                param={param}
                params={context}
                ready={previous.every(
                  (param) => !param.required || Boolean(values[param.key]),
                )}
                value={values[param.key] ?? ""}
                computers={computers}
                transport={transport}
                onChange={(value) => {
                  setValues((before) => {
                    const next = Object.fromEntries(
                      declared.slice(0, index).flatMap((param) => {
                        const value = before[param.key];
                        return value ? [[param.key, value]] : [];
                      }),
                    );
                    if (value) next[param.key] = value;
                    return next;
                  });
                }}
              />
            );
          })}
          <FormFooter error={error}>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!validDesktopGillParams(values, declared)}
            >
              {editing ? "Save widget" : "Place widget"}
            </Button>
          </FormFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ParameterChoice({
  surfaceId,
  viewId,
  param,
  params,
  ready,
  value,
  computers,
  transport,
  onChange,
}: {
  surfaceId: string;
  viewId: string;
  param: AppGillParam;
  params: Readonly<Record<string, string>>;
  ready: boolean;
  value: string;
  computers: readonly Readonly<{ computerId: string; name: string }>[];
  transport: DesktopGillTransport;
  onChange: (value: string) => void;
}) {
  const [reply, setReply] = useState<GillOptionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [after, setAfter] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const latestParams = useRef(params);
  latestParams.current = params;
  const contextKey = JSON.stringify(params);
  useEffect(() => {
    if (!ready || param.options === undefined || param.kind === "computer") {
      setReply(null);
      return;
    }
    let retired = false;
    setLoading(true);
    setError(null);
    let request: GillRequest & { surfaceId: string } = {
      surfaceId,
      viewId,
      options: param.key,
      params: latestParams.current,
    };
    if (after !== undefined) request = { ...request, after };
    void transport
      .requestGill(request)
      .then((reply) => {
        if (retired) return;
        if (!("options" in reply))
          throw new Error(
            reply.state === "error"
              ? reply.error
              : "The widget returned rows instead of choices.",
          );
        setReply(reply);
      })
      .catch((cause: unknown) => {
        if (retired) return;
        console.error("Gill choices could not be read", {
          surfaceId,
          viewId,
          parameter: param.key,
          cause,
        });
        setReply(null);
        setError(`Choices for ${param.label} could not be loaded.`);
      })
      .finally(() => {
        if (!retired) setLoading(false);
      });
    return () => {
      retired = true;
    };
  }, [
    surfaceId,
    viewId,
    param.key,
    param.kind,
    param.options,
    contextKey,
    ready,
    after,
    retry,
    transport,
  ]);
  const choices =
    param.kind === "computer"
      ? computers.map((computer) => ({
          value: computer.computerId,
          label: computer.name,
        }))
      : (reply?.options ?? []);
  return (
    <div>
      <Field
        label={param.label}
        required={param.required}
        optional={!param.required}
        error={error}
      >
        {param.kind === "computer" || param.options !== undefined ? (
          <Select
            aria-label={param.label}
            value={value}
            disabled={!ready || loading}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
          >
            <option value="">
              {loading ? "Loading choices…" : `Choose a ${param.kind}`}
            </option>
            {value && !choices.some((choice) => choice.value === value) ? (
              <option value={value}>{value}</option>
            ) : null}
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            aria-label={param.label}
            value={value}
            maxLength={256}
            disabled={!ready}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      {reply?.next !== undefined ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => {
            setAfter(reply.next);
          }}
        >
          More choices
        </Button>
      ) : null}
      {error ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setRetry((value) => value + 1);
          }}
        >
          Retry choices
        </Button>
      ) : null}
      {ready &&
      !loading &&
      !error &&
      (param.kind === "computer" || param.options !== undefined) &&
      choices.length === 0 ? (
        <p role="status">No {param.kind} choices available.</p>
      ) : null}
    </div>
  );
}
