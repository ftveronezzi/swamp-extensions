/**
 * CRIBL Stream Cloud — read-only integration for troubleshooting sources,
 * routes, pipelines, destinations, event capture, lookups, and knowledge
 * objects via the CRIBL Cloud REST API.
 *
 * Authentication uses OAuth2 client_credentials grant against CRIBL Cloud.
 * All methods are read-only observation/sync operations.
 *
 * @module
 */
import { z } from "npm:zod@4.4.3";

// =============================================================================
// Schemas
// =============================================================================

const GlobalArgsSchema = z.object({
  baseUrl: z
    .string()
    .describe(
      "CRIBL Cloud base URL (e.g. https://main-<org>.cribl.cloud)",
    ),
  clientId: z.string().meta({ sensitive: true }).describe(
    "CRIBL API Client ID",
  ),
  clientSecret: z
    .string()
    .meta({ sensitive: true })
    .describe("CRIBL API Client Secret"),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

// --- Resource output schemas ---

const SourceSchema = z.object({
  id: z.string(),
  type: z.string(),
  disabled: z.boolean(),
  description: z.string().optional(),
  config: z.record(z.unknown()),
});

const SourcesOutputSchema = z.object({
  workerGroup: z.string(),
  sources: z.array(SourceSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const SourceDetailSchema = z.object({
  workerGroup: z.string(),
  source: SourceSchema,
  fetchedAt: z.string(),
});

const RouteSchema = z.object({
  id: z.string(),
  name: z.string(),
  filter: z.string(),
  pipeline: z.string().optional(),
  output: z.string().optional(),
  disabled: z.boolean(),
  description: z.string().optional(),
  groups: z.record(z.unknown()).optional(),
});

const RoutesOutputSchema = z.object({
  workerGroup: z.string(),
  routes: z.array(RouteSchema),
  totalCount: z.number(),
  enabledCount: z.number(),
  disabledCount: z.number(),
  fetchedAt: z.string(),
});

const PipelineFunctionSchema = z.object({
  id: z.string(),
  filter: z.string().optional(),
  disabled: z.boolean().optional(),
  description: z.string().optional(),
  conf: z.record(z.unknown()).optional(),
});

const PipelineSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
  functions: z.array(PipelineFunctionSchema).optional(),
});

const PipelinesOutputSchema = z.object({
  workerGroup: z.string(),
  pipelines: z.array(PipelineSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const PipelineDetailSchema = z.object({
  workerGroup: z.string(),
  pipeline: PipelineSchema,
  fetchedAt: z.string(),
});

const DestinationSchema = z.object({
  id: z.string(),
  type: z.string(),
  disabled: z.boolean(),
  description: z.string().optional(),
  config: z.record(z.unknown()),
});

const DestinationsOutputSchema = z.object({
  workerGroup: z.string(),
  destinations: z.array(DestinationSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const DestinationDetailSchema = z.object({
  workerGroup: z.string(),
  destination: DestinationSchema,
  fetchedAt: z.string(),
});

const CaptureEventSchema = z.object({
  _raw: z.string().optional(),
  _time: z.unknown().optional(),
  fields: z.record(z.unknown()),
});

const CaptureOutputSchema = z.object({
  workerGroup: z.string(),
  captureId: z.string(),
  filter: z.string().optional(),
  events: z.array(CaptureEventSchema),
  eventCount: z.number(),
  fetchedAt: z.string(),
});

const LookupSchema = z.object({
  id: z.string(),
  fileInfo: z.record(z.unknown()).optional(),
  size: z.number().optional(),
  description: z.string().optional(),
});

const LookupsOutputSchema = z.object({
  workerGroup: z.string(),
  lookups: z.array(LookupSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const KnowledgeObjectSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string().optional(),
  config: z.record(z.unknown()),
});

const KnowledgeOutputSchema = z.object({
  workerGroup: z.string(),
  objectType: z.string(),
  objects: z.array(KnowledgeObjectSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const HealthComponentSchema = z.object({
  type: z.string(),
  id: z.string(),
  status: z.enum(["healthy", "warning", "error", "disabled"]),
  message: z.string().optional(),
});

const HealthOutputSchema = z.object({
  workerGroup: z.string(),
  overall: z.enum(["healthy", "warning", "error"]),
  components: z.array(HealthComponentSchema),
  sourcesTotal: z.number(),
  destinationsTotal: z.number(),
  pipelinesTotal: z.number(),
  routesTotal: z.number(),
  fetchedAt: z.string(),
});

// =============================================================================
// Helpers
// =============================================================================

interface ModelContext {
  globalArgs: GlobalArgs;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warning: (msg: string, meta?: Record<string, unknown>) => void;
  };
  writeResource: (
    specName: string,
    instanceName: string,
    data: Record<string, unknown>,
  ) => Promise<{
    name: string;
    specName: string;
    kind: string;
    dataId: string;
    version: number;
    size: number;
  }>;
}

/** Cached bearer token with expiry. */
let tokenCache: { token: string; expiresAt: number } | null = null;

/** Obtain a bearer token via OAuth2 client_credentials grant. */
async function getAccessToken(
  _baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.token;
  }

  // CRIBL Cloud uses a centralized identity service for OAuth
  const tokenUrl = "https://login.cribl.cloud/oauth/token";
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: "https://api.cribl.cloud",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "[unreadable]");
    throw new Error(`CRIBL auth failed (${resp.status}): ${body}`);
  }

  const data = await resp.json() as {
    access_token: string;
    expires_in?: number;
  };
  const expiresIn = (data.expires_in ?? 3600) * 1000;
  tokenCache = { token: data.access_token, expiresAt: now + expiresIn };
  return data.access_token;
}

/** Make an authenticated GET request to the CRIBL API. */
async function criblGet(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  path: string,
): Promise<unknown> {
  const token = await getAccessToken(baseUrl, clientId, clientSecret);
  const url = `${baseUrl}${path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "[unreadable]");
    throw new Error(`CRIBL API ${resp.status} ${path}: ${body}`);
  }
  return resp.json();
}

/** Make an authenticated POST request to the CRIBL API. */
async function criblPost(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const token = await getAccessToken(baseUrl, clientId, clientSecret);
  const url = `${baseUrl}${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const body2 = await resp.text().catch(() => "[unreadable]");
    throw new Error(`CRIBL API POST ${resp.status} ${path}: ${body2}`);
  }
  return resp.json();
}

function workerPath(workerGroup: string, subpath: string): string {
  return `/api/v1/m/${encodeURIComponent(workerGroup)}${subpath}`;
}

function instanceKey(prefix: string, workerGroup: string, id?: string): string {
  const base = `${prefix}-${workerGroup}`;
  return id ? `${base}-${id}` : base;
}

// =============================================================================
// Model Definition
// =============================================================================

/** CRIBL Stream Cloud read-only integration for troubleshooting. */
export const model = {
  type: "@figura/cribl-stream",
  version: "2026.07.07.2",
  globalArguments: GlobalArgsSchema,
  resources: {
    sources: {
      description: "Input sources configured in a worker group",
      schema: SourcesOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 5,
    },
    source_detail: {
      description: "Detailed config for a specific source",
      schema: SourceDetailSchema,
      lifetime: "15m" as const,
      garbageCollection: 10,
    },
    routes: {
      description: "Routes configured in a worker group",
      schema: RoutesOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 5,
    },
    pipelines: {
      description: "Pipelines configured in a worker group",
      schema: PipelinesOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 5,
    },
    pipeline_detail: {
      description: "Detailed config for a specific pipeline with functions",
      schema: PipelineDetailSchema,
      lifetime: "15m" as const,
      garbageCollection: 10,
    },
    destinations: {
      description: "Output destinations configured in a worker group",
      schema: DestinationsOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 5,
    },
    destination_detail: {
      description: "Detailed config for a specific destination",
      schema: DestinationDetailSchema,
      lifetime: "15m" as const,
      garbageCollection: 10,
    },
    capture: {
      description: "Captured events from a pipeline point",
      schema: CaptureOutputSchema,
      lifetime: "30m" as const,
      garbageCollection: 5,
    },
    lookups: {
      description: "Lookup files in a worker group",
      schema: LookupsOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 5,
    },
    knowledge: {
      description: "Knowledge objects (parsers, schemas, global variables)",
      schema: KnowledgeOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 5,
    },
    health: {
      description: "Aggregated health overview of a worker group",
      schema: HealthOutputSchema,
      lifetime: "5m" as const,
      garbageCollection: 5,
    },
  },
  methods: {
    list_sources: {
      description:
        "List all input sources in a worker group with their type and enabled/disabled status.",
      arguments: z.object({
        workerGroup: z.string().describe(
          "Worker group name (e.g. default, acceptance)",
        ),
      }),
      execute: async (
        args: { workerGroup: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(args.workerGroup, "/system/inputs");
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];

        // deno-lint-ignore no-explicit-any
        const sources = items.map((item: any) => ({
          id: item.id ?? "unknown",
          type: item.type ?? "unknown",
          disabled: item.disabled ?? false,
          description: item.description ?? undefined,
          config: item,
        }));

        const data = {
          workerGroup: args.workerGroup,
          sources,
          totalCount: sources.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "sources",
          instanceKey("sources", args.workerGroup),
          data,
        );

        context.logger.info("Fetched CRIBL sources", {
          workerGroup: args.workerGroup,
          count: sources.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_source: {
      description: "Get detailed configuration for a specific source by ID.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
        sourceId: z.string().describe("Source ID"),
      }),
      execute: async (
        args: { workerGroup: string; sourceId: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(
          args.workerGroup,
          `/system/inputs/${encodeURIComponent(args.sourceId)}`,
        );
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];
        // deno-lint-ignore no-explicit-any
        const item = items[0] as any;

        if (!item) {
          throw new Error(
            `Source '${args.sourceId}' not found in worker group '${args.workerGroup}'`,
          );
        }

        const source = {
          id: item.id ?? args.sourceId,
          type: item.type ?? "unknown",
          disabled: item.disabled ?? false,
          description: item.description ?? undefined,
          config: item,
        };

        const data = {
          workerGroup: args.workerGroup,
          source,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "source_detail",
          instanceKey("source", args.workerGroup, args.sourceId),
          data,
        );

        context.logger.info("Fetched CRIBL source detail", {
          workerGroup: args.workerGroup,
          sourceId: args.sourceId,
        });
        return { dataHandles: [handle] };
      },
    },

    list_routes: {
      description:
        "List all routes in a worker group with their filter, pipeline, output, and enabled/disabled state.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
      }),
      execute: async (
        args: { workerGroup: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(args.workerGroup, "/routes");
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };

        // CRIBL routes API returns { items: [{ id, routes: [...] }] }
        // The actual route entries are nested inside items[0].routes
        // deno-lint-ignore no-explicit-any
        const topLevel = resp.items ?? [] as any[];
        // deno-lint-ignore no-explicit-any
        let routeEntries: any[] = [];
        // deno-lint-ignore no-explicit-any
        for (const group of topLevel as any[]) {
          if (group.routes && Array.isArray(group.routes)) {
            routeEntries = routeEntries.concat(group.routes);
          } else if (
            group.filter !== undefined || group.pipeline !== undefined
          ) {
            // Flat structure fallback — item itself is a route
            routeEntries.push(group);
          }
        }

        // deno-lint-ignore no-explicit-any
        const routes = routeEntries.map((item: any) => ({
          id: item.id ?? "unknown",
          name: item.name ?? item.id ?? "unknown",
          filter: item.filter ?? "true",
          pipeline: item.pipeline ?? undefined,
          output: item.output ?? undefined,
          disabled: item.disabled ?? false,
          description: item.description ?? undefined,
          groups: item.groups ?? undefined,
        }));

        const enabledCount =
          routes.filter((r: { disabled: boolean }) => !r.disabled).length;
        const disabledCount =
          routes.filter((r: { disabled: boolean }) => r.disabled).length;

        const data = {
          workerGroup: args.workerGroup,
          routes,
          totalCount: routes.length,
          enabledCount,
          disabledCount,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "routes",
          instanceKey("routes", args.workerGroup),
          data,
        );

        context.logger.info("Fetched CRIBL routes", {
          workerGroup: args.workerGroup,
          total: routes.length,
          enabled: enabledCount,
          disabled: disabledCount,
        });
        return { dataHandles: [handle] };
      },
    },

    list_pipelines: {
      description: "List all pipelines in a worker group.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
      }),
      execute: async (
        args: { workerGroup: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(args.workerGroup, "/pipelines");
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];

        // deno-lint-ignore no-explicit-any
        const pipelines = items.map((item: any) => ({
          id: item.id ?? "unknown",
          description: item.description ?? undefined,
          disabled: item.disabled ?? false,
          // deno-lint-ignore no-explicit-any
          functions: item.conf?.functions?.map((fn: any) => ({
            id: fn.id ?? "unknown",
            filter: fn.filter ?? undefined,
            disabled: fn.disabled ?? false,
            description: fn.description ?? undefined,
            conf: fn.conf ?? undefined,
          })) ?? undefined,
        }));

        const data = {
          workerGroup: args.workerGroup,
          pipelines,
          totalCount: pipelines.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "pipelines",
          instanceKey("pipelines", args.workerGroup),
          data,
        );

        context.logger.info("Fetched CRIBL pipelines", {
          workerGroup: args.workerGroup,
          count: pipelines.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_pipeline: {
      description:
        "Get detailed configuration for a specific pipeline, including all functions.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
        pipelineId: z.string().describe("Pipeline ID"),
      }),
      execute: async (
        args: { workerGroup: string; pipelineId: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(
          args.workerGroup,
          `/pipelines/${encodeURIComponent(args.pipelineId)}`,
        );
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];
        // deno-lint-ignore no-explicit-any
        const item = items[0] as any;

        if (!item) {
          throw new Error(
            `Pipeline '${args.pipelineId}' not found in worker group '${args.workerGroup}'`,
          );
        }

        const pipeline = {
          id: item.id ?? args.pipelineId,
          description: item.description ?? undefined,
          disabled: item.disabled ?? false,
          // deno-lint-ignore no-explicit-any
          functions: item.conf?.functions?.map((fn: any) => ({
            id: fn.id ?? "unknown",
            filter: fn.filter ?? undefined,
            disabled: fn.disabled ?? false,
            description: fn.description ?? undefined,
            conf: fn.conf ?? undefined,
          })) ?? [],
        };

        const data = {
          workerGroup: args.workerGroup,
          pipeline,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "pipeline_detail",
          instanceKey("pipeline", args.workerGroup, args.pipelineId),
          data,
        );

        context.logger.info("Fetched CRIBL pipeline detail", {
          workerGroup: args.workerGroup,
          pipelineId: args.pipelineId,
          functionCount: pipeline.functions?.length ?? 0,
        });
        return { dataHandles: [handle] };
      },
    },

    list_destinations: {
      description:
        "List all output destinations in a worker group with their type and status.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
      }),
      execute: async (
        args: { workerGroup: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(args.workerGroup, "/system/outputs");
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];

        // deno-lint-ignore no-explicit-any
        const destinations = items.map((item: any) => ({
          id: item.id ?? "unknown",
          type: item.type ?? "unknown",
          disabled: item.disabled ?? false,
          description: item.description ?? undefined,
          config: item,
        }));

        const data = {
          workerGroup: args.workerGroup,
          destinations,
          totalCount: destinations.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "destinations",
          instanceKey("destinations", args.workerGroup),
          data,
        );

        context.logger.info("Fetched CRIBL destinations", {
          workerGroup: args.workerGroup,
          count: destinations.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_destination: {
      description:
        "Get detailed configuration for a specific destination by ID.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
        destinationId: z.string().describe("Destination ID"),
      }),
      execute: async (
        args: { workerGroup: string; destinationId: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(
          args.workerGroup,
          `/system/outputs/${encodeURIComponent(args.destinationId)}`,
        );
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];
        // deno-lint-ignore no-explicit-any
        const item = items[0] as any;

        if (!item) {
          throw new Error(
            `Destination '${args.destinationId}' not found in worker group '${args.workerGroup}'`,
          );
        }

        const destination = {
          id: item.id ?? args.destinationId,
          type: item.type ?? "unknown",
          disabled: item.disabled ?? false,
          description: item.description ?? undefined,
          config: item,
        };

        const data = {
          workerGroup: args.workerGroup,
          destination,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "destination_detail",
          instanceKey("destination", args.workerGroup, args.destinationId),
          data,
        );

        context.logger.info("Fetched CRIBL destination detail", {
          workerGroup: args.workerGroup,
          destinationId: args.destinationId,
        });
        return { dataHandles: [handle] };
      },
    },

    capture_events: {
      description:
        "Capture/preview live events at a specific point in the pipeline. " +
        "Returns a sample of events flowing through a given source or pipeline.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
        sourceId: z.string().optional().describe(
          "Source ID to capture from (optional if pipelineId given)",
        ),
        pipelineId: z.string().optional().describe(
          "Pipeline ID to capture from (optional if sourceId given)",
        ),
        filter: z.string().optional().describe(
          "Optional filter expression to narrow captured events",
        ),
        maxEvents: z.number().default(10).describe(
          "Maximum number of events to capture (default: 10)",
        ),
      }),
      execute: async (
        args: {
          workerGroup: string;
          sourceId?: string;
          pipelineId?: string;
          filter?: string;
          maxEvents: number;
        },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;

        if (!args.sourceId && !args.pipelineId) {
          throw new Error(
            "Must provide either sourceId or pipelineId for event capture",
          );
        }

        // CRIBL Cloud live capture endpoint
        const captureParams: Record<string, unknown> = {
          level: args.pipelineId ? "after" : "before",
          workerCount: 1,
          maxEvents: args.maxEvents,
        };
        if (args.filter) captureParams.filter = args.filter;

        let captureTarget: string;
        if (args.pipelineId) {
          captureTarget = args.pipelineId;
          captureParams.pipelineId = args.pipelineId;
        } else {
          captureTarget = args.sourceId!;
          captureParams.inputId = args.sourceId;
        }

        const path = workerPath(args.workerGroup, "/lib/jobs");
        const jobBody = {
          type: "capture",
          ...captureParams,
        };

        const jobResp = await criblPost(
          baseUrl,
          clientId,
          clientSecret,
          path,
          jobBody,
        ) as {
          items?: Array<{ id?: string }>;
        };

        const jobId = jobResp.items?.[0]?.id;
        if (!jobId) {
          throw new Error("Failed to create capture job — no job ID returned");
        }

        // Poll for capture results (max 30s)
        let events: Array<Record<string, unknown>> = [];
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const resultPath = workerPath(
            args.workerGroup,
            `/lib/jobs/${jobId}/results`,
          );
          try {
            const resultResp = await criblGet(
              baseUrl,
              clientId,
              clientSecret,
              resultPath,
            ) as {
              items?: unknown[];
            };
            if (resultResp.items && resultResp.items.length > 0) {
              events = resultResp.items as Array<Record<string, unknown>>;
              break;
            }
          } catch {
            // Job may still be running, retry
          }
        }

        const capturedEvents = events.slice(0, args.maxEvents).map((e) => ({
          _raw: typeof e._raw === "string" ? e._raw : JSON.stringify(e),
          _time: e._time ?? undefined,
          fields: e,
        }));

        const data = {
          workerGroup: args.workerGroup,
          captureId: jobId,
          filter: args.filter ?? undefined,
          events: capturedEvents,
          eventCount: capturedEvents.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "capture",
          instanceKey("capture", args.workerGroup, captureTarget),
          data,
        );

        context.logger.info("Captured CRIBL events", {
          workerGroup: args.workerGroup,
          target: captureTarget,
          eventCount: capturedEvents.length,
        });
        return { dataHandles: [handle] };
      },
    },

    list_lookups: {
      description: "List all lookup files available in a worker group.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
      }),
      execute: async (
        args: { workerGroup: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;
        const path = workerPath(args.workerGroup, "/system/lookups");
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];

        // deno-lint-ignore no-explicit-any
        const lookups = items.map((item: any) => ({
          id: item.id ?? "unknown",
          fileInfo: item.fileInfo ?? undefined,
          size: item.size ?? undefined,
          description: item.description ?? undefined,
        }));

        const data = {
          workerGroup: args.workerGroup,
          lookups,
          totalCount: lookups.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "lookups",
          instanceKey("lookups", args.workerGroup),
          data,
        );

        context.logger.info("Fetched CRIBL lookups", {
          workerGroup: args.workerGroup,
          count: lookups.length,
        });
        return { dataHandles: [handle] };
      },
    },

    list_knowledge: {
      description:
        "List knowledge objects (parsers, global variables, schemas) in a worker group.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
        objectType: z
          .enum(["parsers", "global-variables", "schemas"])
          .default("parsers")
          .describe("Type of knowledge object to list"),
      }),
      execute: async (
        args: { workerGroup: string; objectType: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;

        // Map friendly names to API paths
        const apiPaths: Record<string, string> = {
          parsers: "/parsers",
          "global-variables": "/lib/vars",
          schemas: "/schemas",
        };

        const subpath = apiPaths[args.objectType] ?? `/lib/${args.objectType}`;
        const path = workerPath(args.workerGroup, subpath);
        const resp = await criblGet(baseUrl, clientId, clientSecret, path) as {
          items?: unknown[];
        };
        const items = resp.items ?? [];

        // deno-lint-ignore no-explicit-any
        const objects = items.map((item: any) => ({
          id: item.id ?? "unknown",
          type: args.objectType,
          description: item.description ?? undefined,
          config: item,
        }));

        const data = {
          workerGroup: args.workerGroup,
          objectType: args.objectType,
          objects,
          totalCount: objects.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "knowledge",
          instanceKey("knowledge", args.workerGroup, args.objectType),
          data,
        );

        context.logger.info("Fetched CRIBL knowledge objects", {
          workerGroup: args.workerGroup,
          objectType: args.objectType,
          count: objects.length,
        });
        return { dataHandles: [handle] };
      },
    },

    health: {
      description:
        "Fan-out health check: scans all sources, routes, pipelines, and destinations " +
        "in a worker group and flags any that are disabled or misconfigured.",
      arguments: z.object({
        workerGroup: z.string().describe("Worker group name"),
      }),
      execute: async (
        args: { workerGroup: string },
        context: ModelContext,
      ) => {
        const { baseUrl, clientId, clientSecret } = context.globalArgs;

        // Fetch all four object types in parallel
        const [sourcesResp, routesResp, pipelinesResp, destsResp] =
          await Promise.all([
            criblGet(
              baseUrl,
              clientId,
              clientSecret,
              workerPath(args.workerGroup, "/system/inputs"),
            ) as Promise<{ items?: unknown[] }>,
            criblGet(
              baseUrl,
              clientId,
              clientSecret,
              workerPath(args.workerGroup, "/routes"),
            ) as Promise<{ items?: unknown[] }>,
            criblGet(
              baseUrl,
              clientId,
              clientSecret,
              workerPath(args.workerGroup, "/pipelines"),
            ) as Promise<{ items?: unknown[] }>,
            criblGet(
              baseUrl,
              clientId,
              clientSecret,
              workerPath(args.workerGroup, "/system/outputs"),
            ) as Promise<{ items?: unknown[] }>,
          ]);

        const components: Array<{
          type: string;
          id: string;
          status: "healthy" | "warning" | "error" | "disabled";
          message?: string;
        }> = [];

        // Check sources
        // deno-lint-ignore no-explicit-any
        for (const item of (sourcesResp.items ?? []) as any[]) {
          if (item.disabled) {
            components.push({
              type: "source",
              id: item.id,
              status: "disabled",
              message: "Source is disabled",
            });
          } else {
            components.push({ type: "source", id: item.id, status: "healthy" });
          }
        }

        // Check routes
        // deno-lint-ignore no-explicit-any
        for (const item of (routesResp.items ?? []) as any[]) {
          if (item.disabled) {
            components.push({
              type: "route",
              id: item.id ?? item.name,
              status: "disabled",
              message: "Route is disabled",
            });
          } else if (!item.pipeline && !item.output) {
            components.push({
              type: "route",
              id: item.id ?? item.name,
              status: "warning",
              message: "Route has no pipeline or output",
            });
          } else {
            components.push({
              type: "route",
              id: item.id ?? item.name,
              status: "healthy",
            });
          }
        }

        // Check pipelines
        // deno-lint-ignore no-explicit-any
        for (const item of (pipelinesResp.items ?? []) as any[]) {
          if (item.disabled) {
            components.push({
              type: "pipeline",
              id: item.id,
              status: "disabled",
              message: "Pipeline is disabled",
            });
          } else {
            components.push({
              type: "pipeline",
              id: item.id,
              status: "healthy",
            });
          }
        }

        // Check destinations
        // deno-lint-ignore no-explicit-any
        for (const item of (destsResp.items ?? []) as any[]) {
          if (item.disabled) {
            components.push({
              type: "destination",
              id: item.id,
              status: "disabled",
              message: "Destination is disabled",
            });
          } else {
            components.push({
              type: "destination",
              id: item.id,
              status: "healthy",
            });
          }
        }

        // Determine overall health
        const hasError = components.some((c) => c.status === "error");
        const hasWarning = components.some((c) => c.status === "warning");
        const overall = hasError ? "error" : hasWarning ? "warning" : "healthy";

        const data = {
          workerGroup: args.workerGroup,
          overall,
          components,
          sourcesTotal: (sourcesResp.items ?? []).length,
          destinationsTotal: (destsResp.items ?? []).length,
          pipelinesTotal: (pipelinesResp.items ?? []).length,
          routesTotal: (routesResp.items ?? []).length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "health",
          instanceKey("health", args.workerGroup),
          data,
        );

        context.logger.info("CRIBL health check complete", {
          workerGroup: args.workerGroup,
          overall,
          components: components.length,
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
