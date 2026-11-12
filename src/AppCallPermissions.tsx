import { appCallMethodLabel } from "@fungi.computer/nacre/app-directory";
import {
  DataList,
  DataListHeading,
  DataRow,
} from "@fungi.computer/caps/components/data-list";
import type { AppDeclaration } from "@fungi.computer/puffball/app";

/** The declared deputy ceiling, shown identically on both hosts; this grants nothing. */
export function AppCallPermissions({
  calls,
  apps,
}: {
  calls: AppDeclaration["calls"];
  apps: readonly { appId: string; displayName?: string | undefined }[];
}): React.JSX.Element | null {
  if (!calls?.length) return null;
  return (
    <section aria-label="Calls to other Apps">
      <DataListHeading level={3}>Other Apps</DataListHeading>
      <DataList density="compact">
        {calls.map((call) => (
          <DataRow key={call.appId}>
            <span>
              Can use{" "}
              {apps.find((app) => app.appId === call.appId)?.displayName ??
                call.appId}
              : {call.methods.map(appCallMethodLabel).join(", ")}
            </span>
          </DataRow>
        ))}
      </DataList>
      <p className="tourtois-call-permissions-note text-xs">
        Calls use your permissions in the other App. Renamed target methods need
        approval again.
      </p>
    </section>
  );
}
