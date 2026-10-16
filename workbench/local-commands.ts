import type {
  AppCommand,
  AppCommandHandler,
  AppRoot,
} from "@fungi.computer/agar";
import type { AppSurfaceCommandHost } from "@fungi.computer/oyster/shell/command-host";
import type { AppDeclaredCommand } from "@fungi.computer/puffball/app";

/** In-process transport only. The real Hub bridge owns projection and dispatch. */
export async function mountLocalCommands(
  host: AppSurfaceCommandHost,
  surfaceId: string,
  declarations: readonly AppDeclaredCommand[],
) {
  const mount = host.mount(surfaceId, declarations);
  const registrations = new Map<
    string,
    { command: AppCommand; handler: AppCommandHandler }
  >();
  let disposed = false;
  const contribution = await mount.handlers.registerCommands({
    commands: [],
    invoke: async (id, input) => {
      const registration = registrations.get(id);
      if (!registration || disposed)
        throw new Error("This App command has closed.");
      return await registration.handler({
        ...input,
        signal: input.signal ?? new AbortController().signal,
      });
    },
  });
  const publish = () => {
    contribution.update(
      [...registrations.values()].map(({ command }) => command),
    );
  };
  const commands: AppRoot["commands"] = {
    register: (command, handler) => {
      if (disposed)
        return Promise.reject(new Error("App command mount closed"));
      if (registrations.has(command.id))
        return Promise.reject(new Error("Duplicate App command"));
      const entry = { command, handler };
      registrations.set(command.id, entry);
      publish();
      return Promise.resolve(() => {
        if (registrations.get(command.id) !== entry) return;
        registrations.delete(command.id);
        if (!disposed) publish();
      });
    },
  };
  return {
    commands,
    dispose: () => {
      disposed = true;
      registrations.clear();
      mount.dispose();
    },
  };
}
