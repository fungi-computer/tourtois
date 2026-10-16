import {
  DataList,
  DataListHeading,
  DataRow,
} from "@fungi.computer/caps/components/data-list";
import type { AppDeclaration } from "@fungi.computer/puffball/app";

const methodLabels = new Map([
  ["files.tree", "browse files"],
  ["files.list", "list files"],
  ["files.read", "read files"],
  ["commits.list", "read commits"],
  ["rebuildCopies", "refresh file views"],
  ["files.save", "save files"],
  ["files.sync", "sync files"],
  ["files.discard", "discard edits"],
]);

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
              :{" "}
              {call.methods
                .map((method) => methodLabels.get(method) ?? method)
                .join(", ")}
            </span>
          </DataRow>
        ))}
      </DataList>
      <p className="mt-1 text-xs">
        Calls use your permissions in the other App. Renamed target methods need
        approval again.
      </p>
    </section>
  );
}
