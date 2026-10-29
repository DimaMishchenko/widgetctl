#!/usr/bin/env node
import {
  Server,
  type CallToolResult,
  type Tool,
  type Transport,
} from "@modelcontextprotocol/server";
import {
  serveStdio,
  StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createController, type WidgetController } from "./controller.js";
import { listSimulators, listApplications } from "./discovery.js";
import { doctor } from "./doctor.js";
import { WidgetctlError, classifyError } from "./errors.js";

const version: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const identity = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim().length > 0,
    "A nonblank identity is required",
  );
const udid = z
  .uuid()
  .describe(
    "Explicit UUID of an available booted iOS simulator owned by this task; never 'booted'.",
  );
const device = { udid };
const instance = {
  ...device,
  iconIdentifier: z
    .uuid()
    .describe(
      "Exact installed widget icon UUID returned by widgetctl_installed or widgetctl_ensure.",
    ),
};
const target = z.strictObject({
  extension: identity,
  container: identity,
  kind: identity,
  size: z.enum(["small", "medium", "large"]),
});
const configuration = z
  .object({
    schemaVersion: z.literal(1),
    extension: identity,
    kind: identity,
    size: z.enum(["small", "medium", "large"]),
    container: identity,
    intent: z.strictObject({
      intentClass: z.literal("INAppIntent"),
      appBundleIdentifier: identity,
      extensionBundleIdentifier: identity,
      appIntentIdentifier: identity,
      parameters: z.record(z.string(), z.json()),
    }),
  })
  .catchall(z.json())
  .describe(
    "Complete canonical schemaVersion 1 configuration from export; preserve the intent envelope and identity.",
  );

export interface McpDependencies {
  createController: (options: { udid: string }) => WidgetController;
  listSimulators: typeof listSimulators;
  listApplications: typeof listApplications;
  doctor: typeof doctor;
}
const defaults: McpDependencies = {
  createController,
  listSimulators,
  listApplications,
  doctor,
};
const cancelled = () =>
  new WidgetctlError(
    "The request was cancelled before the next operation began.",
    { code: "CANCELLED" },
  );
const check = (signal: AbortSignal) => {
  if (signal.aborted) throw cancelled();
};
function result(
  value: Record<string, unknown>,
  isError = false,
): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

export function createMcpServer(overrides: Partial<McpDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const server = new Server(
    { name: "widgetctl", version },
    {
      capabilities: { tools: {} },
      instructions:
        "Use widgetctl_devices to select an explicitly owned booted simulator. Launch the containing app before widget catalog discovery. List installed widgets for exact icon identities. Export before editing configuration, and pass the original export as expected when applying. Operations prepare and release their own helper. Cancellation does not roll back a mutation already started; inspect current state before retrying. Other simulator owners must finish before using the same simulator.",
    },
  );
  let queue: Promise<unknown> = Promise.resolve();
  let closing = false;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(cancelled());
    const pending = queue.then(async () => {
      if (closing) throw cancelled();
      return operation();
    });
    queue = pending.catch(() => undefined);
    return pending;
  };
  async function session<T>(
    id: string,
    signal: AbortSignal,
    operation: (controller: WidgetController) => Promise<T>,
  ) {
    check(signal);
    const controller = deps.createController({ udid: id });
    let failure: unknown;
    try {
      await controller.prepare();
      check(signal);
      return await operation(controller);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        await controller.release();
      } catch (cleanup) {
        throw new WidgetctlError("Simulator helper cleanup failed.", {
          code: "CLEANUP_FAILED",
          cause: cleanup,
          recovery: [
            classifyError(cleanup).message,
            ...(failure
              ? [`Operation also failed: ${classifyError(failure).message}`]
              : []),
            "Run widgetctl doctor for this UDID and wait for the helper to exit before retrying.",
          ],
        });
      }
    }
  }
  function tool<S extends z.ZodObject>(
    name: string,
    description: string,
    schema: S,
    readOnly: boolean,
    run: (args: z.infer<S>, signal: AbortSignal) => Promise<unknown>,
  ) {
    return {
      name,
      description,
      schema,
      inputSchema: z.toJSONSchema(schema) as Tool["inputSchema"],
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        openWorldHint: false,
      },
      invoke: async (args: unknown, signal: AbortSignal) => {
        const parsed = schema.safeParse(args);
        if (!parsed.success)
          throw new WidgetctlError(parsed.error.message, {
            code: "INVALID_INPUT",
            recovery: [
              "Use tools/list and supply only the documented arguments, including an explicit simulator UUID.",
            ],
          });
        check(signal);
        return run(parsed.data, signal);
      },
    };
  }
  const existing = async (
    id: string,
    icon: string,
    signal: AbortSignal,
    action: (
      handle: Awaited<ReturnType<WidgetController["getWidget"]>>,
    ) => Promise<unknown>,
  ) =>
    session(id, signal, async (controller) => {
      const handle = await controller.getWidget(icon);
      check(signal);
      return action(handle);
    });
  const tools = [
    tool(
      "widgetctl_devices",
      "List available iOS simulators without selecting or booting one.",
      z.strictObject({}),
      true,
      async () => deps.listSimulators(),
    ),
    tool(
      "widgetctl_apps",
      "List installed apps on the explicit booted simulator. Does not launch apps.",
      z.strictObject(device),
      true,
      async ({ udid }) => deps.listApplications(udid),
    ),
    tool(
      "widgetctl_doctor",
      "Read-only host and explicitly selected simulator readiness diagnostics. Does not boot, repair or prepare a simulator.",
      z.strictObject(device),
      true,
      async ({ udid }) => deps.doctor({ udid }),
    ),
    tool(
      "widgetctl_catalog",
      "Discover installed widget kinds, containing apps and supported sizes. Launch the containing app first.",
      z.strictObject(device),
      true,
      async ({ udid }, signal) =>
        session(udid, signal, (controller) => controller.catalog()),
    ),
    tool(
      "widgetctl_installed",
      "List installed widgets with exact icon identities and positions.",
      z.strictObject(device),
      true,
      async ({ udid }, signal) =>
        session(udid, signal, (controller) => controller.installedWidgets()),
    ),
    tool(
      "widgetctl_ensure",
      "Add or reveal a catalog widget. Preserves other widgets; ambiguous existing targets fail. Returns exact instance identity.",
      z.strictObject({
        ...device,
        target,
        position: z.literal("top").optional(),
      }),
      false,
      async ({ udid, target, position }, signal) =>
        session(udid, signal, async (controller) => {
          check(signal);
          const handle = await controller.ensure(target, { position });
          return {
            target: handle.target,
            iconIdentifier: handle.iconIdentifier,
          };
        }),
    ),
    tool(
      "widgetctl_configuration_describe",
      "Describe editable configuration fields and their types for one exact installed widget.",
      z.strictObject(instance),
      true,
      async ({ udid, iconIdentifier }, signal) =>
        existing(udid, iconIdentifier, signal, (handle) =>
          handle.describeConfiguration(),
        ),
    ),
    tool(
      "widgetctl_configuration_export",
      "Export the full canonical configuration of one exact installed widget before editing.",
      z.strictObject(instance),
      true,
      async ({ udid, iconIdentifier }, signal) =>
        existing(udid, iconIdentifier, signal, (handle) =>
          handle.exportConfiguration(),
        ),
    ),
    tool(
      "widgetctl_configuration_choices",
      "Query real choices for an entity parameter. Optional configuration is the draft; expected is its original export.",
      z.strictObject({
        ...instance,
        key: identity.max(256),
        search: z.string().max(512).optional(),
        configuration: configuration.optional(),
        expected: configuration.optional(),
      }),
      true,
      async (
        { udid, iconIdentifier, key, search, configuration, expected },
        signal,
      ) =>
        existing(udid, iconIdentifier, signal, (handle) =>
          handle.configurationChoices(key, search, {
            configuration,
            expected,
            signal,
          }),
        ),
    ),
    tool(
      "widgetctl_configuration_apply",
      "Apply a complete edited configuration to one exact widget. Required expected is the unchanged original export; stale writes fail.",
      z.strictObject({ ...instance, configuration, expected: configuration }),
      false,
      async ({ udid, iconIdentifier, configuration, expected }, signal) =>
        existing(udid, iconIdentifier, signal, (handle) =>
          handle.applyConfiguration(configuration, { expected }),
        ),
    ),
    tool(
      "widgetctl_remove",
      "Remove only the exact installed widget identified by iconIdentifier.",
      z.strictObject(instance),
      false,
      async ({ udid, iconIdentifier }, signal) =>
        existing(udid, iconIdentifier, signal, (handle) => handle.remove()),
    ),
  ];
  server.setRequestHandler("tools/list", async () => ({
    tools: tools.map(({ schema, invoke, ...description }) => description),
  }));
  server.setRequestHandler("tools/call", async (request, context) => {
    try {
      const tool = tools.find((tool) => tool.name === request.params.name);
      if (!tool)
        throw new WidgetctlError("Unknown widgetctl tool.", {
          code: "INVALID_INPUT",
          recovery: ["Use tools/list to discover available tools."],
        });
      const data = await serialize(() =>
        tool.invoke(request.params.arguments ?? {}, context.mcpReq.signal),
      );
      return result({ ok: true, data });
    } catch (error) {
      return result({ ok: false, error: classifyError(error) }, true);
    }
  });
  return {
    server,
    async shutdown() {
      closing = true;
      await queue;
    },
  };
}

export const mcpHelp = `widgetctl-mcp — local stdio MCP server\n\nUsage: widgetctl-mcp [--help | --version]\n\nConnect using an MCP client. Stdout is reserved for MCP JSON-RPC.\nAll simulator tools require an explicit owned, booted UDID.\n`;
export async function runMcp(
  args = process.argv.slice(2),
  dependencies: Partial<McpDependencies> = {},
): Promise<void> {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    process.stdout.write(mcpHelp);
    return;
  }
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (args.length)
    throw new WidgetctlError("Unknown widgetctl-mcp arguments. Use --help.", {
      code: "INVALID_INPUT",
    });
  const apps = new Set<ReturnType<typeof createMcpServer>>();
  let stopping: Promise<void> | undefined;
  const wire = new StdioServerTransport();
  const transport: Transport = {
    async start() {
      wire.onmessage = (message) => transport.onmessage?.(message);
      wire.onerror = (error) => {
        onEnd();
        transport.onerror?.(error);
      };
      wire.onclose = () => {
        onEnd();
        transport.onclose?.();
      };
      await wire.start();
    },
    send: (message) => wire.send(message),
    close: () => wire.close(),
  };
  const handle = serveStdio(
    () => {
      if (stopping) throw cancelled();
      const app = createMcpServer(dependencies);
      apps.add(app);
      return app.server;
    },
    {
      transport,
      onerror: (error) => process.stderr.write(`${error.message}\n`),
    },
  );
  const stop = () =>
    (stopping ??= (async () => {
      const keepAlive = setInterval(() => {}, 1000);
      try {
        await Promise.all([...apps].map((app) => app.shutdown()));
        await handle.close();
      } finally {
        clearInterval(keepAlive);
        process.stdin.off("end", onEnd);
        process.stdin.off("close", onEnd);
        process.off("SIGINT", onEnd);
        process.off("SIGTERM", onEnd);
      }
    })());
  const onEnd = () => {
    void stop().catch((error) => {
      process.stderr.write(`${classifyError(error).message}\n`);
      process.exitCode = 1;
    });
  };
  process.stdin.once("end", onEnd);
  process.stdin.once("close", onEnd);
  process.once("SIGINT", onEnd);
  process.once("SIGTERM", onEnd);
}
if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  void runMcp().catch((error) => {
    process.stderr.write(`${JSON.stringify(classifyError(error))}\n`);
    process.exitCode = 1;
  });
}
