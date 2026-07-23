/**
 * Datadog APM Traces — span search and aggregation
 *
 * Wraps the Datadog Spans API (v2) for searching and aggregating
 * APM trace spans.
 *
 * @module
 */
// SPDX-License-Identifier: MIT

import { z } from "npm:zod@4.4.3";
import { ddApi } from "./_lib/api.ts";

// =============================================================================
// Schemas
// =============================================================================

const GlobalArgsSchema = z.object({
  apiKey: z.string().meta({ sensitive: true }).describe(
    "Datadog API key (DD-API-KEY)",
  ),
  appKey: z.string().meta({ sensitive: true }).describe(
    "Datadog application key (DD-APPLICATION-KEY)",
  ),
  site: z.enum(["us1", "us3", "us5", "eu1", "ap1", "us1-fed"]).default("us1")
    .describe("Datadog site"),
});

const SpanItemSchema = z.object({
  id: z.string().describe("Unique ID of the span."),
  type: z.enum(["spans"]).optional().describe("Type of the event."),
  trace_id: z.string().optional().describe(
    "The trace ID this span belongs to.",
  ),
  span_id: z.string().optional().describe("The span ID."),
  parent_id: z.string().optional().describe("The parent span ID."),
  service: z.string().optional().describe(
    "The service name generating this span.",
  ),
  resource: z.string().optional().describe(
    "The resource name (e.g. endpoint, query).",
  ),
  operation_name: z.string().optional().describe("The operation name."),
  status: z.string().optional().describe("Status of the span (ok, error)."),
  duration: z.number().optional().describe("Duration in nanoseconds."),
  start: z.string().optional().describe("Start timestamp of the span."),
  end: z.string().optional().describe("End timestamp of the span."),
  host: z.string().optional().describe("Host that produced this span."),
  env: z.string().optional().describe("Environment tag value."),
  version: z.string().optional().describe("Service version."),
  error_message: z.string().optional().describe(
    "Error message if status is error.",
  ),
  error_type: z.string().optional().describe("Error type/class."),
  attributes: z.record(z.string(), z.unknown()).optional().describe(
    "Additional span attributes/tags.",
  ),
});

const ListSpansSchema = z.object({
  items: z.array(SpanItemSchema),
  truncated: z.boolean(),
  fetchedAt: z.string(),
});

const AggregateSpansSchema = z.object({
  buckets: z.array(z.unknown()).optional().describe(
    "The list of matching buckets, one item per bucket.",
  ),
});

// =============================================================================
// Helpers
// =============================================================================

const DD_SITES: Record<string, string> = {
  us1: "https://api.datadoghq.com",
  us3: "https://us3.datadoghq.com",
  us5: "https://us5.datadoghq.com",
  eu1: "https://api.datadoghq.eu",
  ap1: "https://ap1.datadoghq.com",
  "us1-fed": "https://api.ddog-gov.com",
};

const MAX_PAGES = 20;

/**
 * Paginated POST for Spans Search using the data-envelope format.
 *
 * The Spans Search API expects:
 *   POST /api/v2/spans/events/search
 *   { data: { attributes: { filter, sort, page: { limit, cursor? } } } }
 *
 * And returns:
 *   { data: [...], meta: { page: { after: "cursor" } } }
 */
async function spanSearchPaginated(
  apiKey: string,
  appKey: string,
  site: string,
  filter: Record<string, unknown>,
  sort?: string,
): Promise<{ results: Record<string, unknown>[]; truncated: boolean }> {
  const baseUrl = DD_SITES[site] ?? DD_SITES.us1;
  const url = `${baseUrl}/api/v2/spans/events/search`;
  const allResults: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let page = 0;
  let truncated = false;

  const headers: Record<string, string> = {
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": appKey,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  while (page < MAX_PAGES) {
    const pageObj: Record<string, unknown> = { limit: 50 };
    if (cursor) pageObj.cursor = cursor;

    const attributes: Record<string, unknown> = {
      filter,
      page: pageObj,
    };
    if (sort) attributes.sort = sort;

    const body = {
      data: {
        type: "search_request",
        attributes,
      },
    };

    let response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // 429 retry
    if (response.status === 429) {
      const retryAfter = Math.min(
        parseInt(response.headers.get("Retry-After") ?? "5", 10),
        60,
      );
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Datadog API rate limited (429) after retry on page ${page}: ${
            text.slice(0, 300)
          }`,
        );
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Datadog API HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    const json = await response.json() as Record<string, unknown>;

    // Extract items from data array (JSON:API format)
    const data = json.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === "object" && "attributes" in item) {
          const flat: Record<string, unknown> = {};
          const i = item as Record<string, unknown>;
          if (i.id) flat.id = i.id;
          if (i.type) flat.type = i.type;
          if (i.attributes && typeof i.attributes === "object") {
            Object.assign(flat, i.attributes as Record<string, unknown>);
          }
          allResults.push(flat);
        } else if (item && typeof item === "object") {
          allResults.push(item as Record<string, unknown>);
        }
      }
    }

    // Get next cursor
    const meta = json.meta as Record<string, unknown> | undefined;
    const metaPage = meta?.page as Record<string, unknown> | undefined;
    cursor = (metaPage?.after as string) ?? null;

    if (!cursor || (Array.isArray(data) && data.length === 0)) break;
    page++;
  }

  if (page >= MAX_PAGES && cursor) {
    truncated = true;
  }

  return { results: allResults, truncated };
}

// =============================================================================
// Model Definition
// =============================================================================

/** Datadog APM Traces — span search and aggregation */
export const model = {
  type: "@figura/datadog/traces",
  version: "2026.07.21.1",
  globalArguments: GlobalArgsSchema,

  upgrades: [],

  resources: {
    "spans": {
      description: "Search spans (POST)",
      schema: ListSpansSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    "aggregate_spans": {
      description: "Aggregate spans",
      schema: AggregateSpansSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
  },

  methods: {
    list_spans: {
      description: "Search spans (POST) — query APM trace spans",
      arguments: z.object({
        filter_query: z.string().optional().describe(
          "Search query following span search syntax (e.g. 'service:web-store AND resource_name:GET /api/v1/users').",
        ),
        filter_from: z.string().optional().describe(
          "Minimum timestamp for requested spans (ISO-8601 or relative like 'now-15m').",
        ),
        filter_to: z.string().optional().describe(
          "Maximum timestamp for requested spans (ISO-8601 or relative like 'now').",
        ),
        sort: z.enum(["timestamp", "-timestamp"]).optional().describe(
          "Sort order for spans. Use 'timestamp' for ascending, '-timestamp' for descending.",
        ),
      }),
      execute: async (
        args: Record<string, unknown>,
        context: {
          globalArgs: Record<string, string>;
          writeResource: (
            spec: string,
            instance: string,
            data: unknown,
          ) => Promise<{ name: string }>;
          logger: {
            info: (msg: string, props: Record<string, unknown>) => void;
          };
        },
      ) => {
        const { apiKey, appKey, site } = context.globalArgs;

        // Build filter object
        const filter: Record<string, unknown> = {};
        if (args.filter_query) filter.query = args.filter_query;
        if (args.filter_from) filter.from = args.filter_from;
        if (args.filter_to) filter.to = args.filter_to;
        if (Object.keys(filter).length === 0) filter.query = "*";

        const { results, truncated } = await spanSearchPaginated(
          apiKey,
          appKey,
          site,
          filter,
          args.sort as string | undefined,
        );

        if (truncated) {
          context.logger.info(
            "WARNING: results truncated at {count} (pagination cap)",
            { count: results.length },
          );
        }

        const handle = await context.writeResource("spans", "main", {
          items: results,
          truncated,
          fetchedAt: new Date().toISOString(),
        });

        context.logger.info("Found {count} spans", { count: results.length });
        return { dataHandles: [handle] };
      },
    },

    aggregate_spans: {
      description:
        "Aggregate spans — compute metrics/timeseries over APM spans",
      arguments: z.object({
        compute: z.array(z.unknown()).optional().describe(
          "The list of metrics or timeseries to compute for the retrieved buckets (e.g. [{aggregation: 'count', type: 'total'}]).",
        ),
        filter: z.unknown().optional().describe(
          "Filter object with query, from, and to fields (e.g. {query: 'service:web-store', from: 'now-1h', to: 'now'}).",
        ),
        group_by: z.array(z.unknown()).optional().describe(
          "The rules for the group by (e.g. [{facet: 'service', limit: 10, sort: {aggregation: 'count', order: 'desc'}}]).",
        ),
        options: z.unknown().optional().describe(
          "Global query options (e.g. {timezone: 'UTC'}).",
        ),
      }),
      execute: async (
        args: Record<string, unknown>,
        context: {
          globalArgs: Record<string, string>;
          writeResource: (
            spec: string,
            instance: string,
            data: unknown,
          ) => Promise<{ name: string }>;
          logger: {
            info: (msg: string, props: Record<string, unknown>) => void;
          };
        },
      ) => {
        const { apiKey, appKey, site } = context.globalArgs;

        // Parse JSON string arguments (swamp passes --arg values as strings)
        const parseArg = (val: unknown): unknown => {
          if (typeof val === "string") {
            try {
              return JSON.parse(val);
            } catch {
              return val;
            }
          }
          return val;
        };

        // Datadog Spans Aggregate API requires data envelope
        const attributes: Record<string, unknown> = {};
        if (args.compute) attributes.compute = parseArg(args.compute);
        if (args.filter) attributes.filter = parseArg(args.filter);
        if (args.group_by) attributes.group_by = parseArg(args.group_by);
        if (args.options) attributes.options = parseArg(args.options);

        const body = {
          data: {
            type: "aggregate_request",
            attributes,
          },
        };

        const result = await ddApi(
          apiKey,
          appKey,
          site,
          "POST",
          `/api/v2/spans/analytics/aggregate`,
          body,
        );

        const handle = await context.writeResource(
          "aggregate_spans",
          "aggregate_spans",
          result ?? {},
        );
        context.logger.info("Executed aggregate_spans", {});
        return { dataHandles: [handle] };
      },
    },
  },
};
