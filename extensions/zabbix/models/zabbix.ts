/**
 * Zabbix — read-only integration for monitoring and troubleshooting via the
 * Zabbix JSON-RPC 2.0 API. Retrieves hosts, problems, triggers, items,
 * history, host groups, maintenance windows, and events.
 *
 * Authentication uses a Zabbix API Token (Bearer header).
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
      "Zabbix server base URL (e.g. https://zabbix.example.com). The API endpoint will be appended as /api_jsonrpc.php",
    ),
  apiToken: z.string().meta({ sensitive: true }).describe(
    "Zabbix API Token for authentication",
  ),
  caCert: z.string().optional().describe(
    "PEM-encoded CA certificate(s) to trust for TLS connections (for internal/private CAs). Store in vault if desired.",
  ),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

// --- Resource output schemas ---

const HostSchema = z.object({
  hostid: z.string(),
  host: z.string(),
  name: z.string(),
  status: z.string().describe("0 = enabled, 1 = disabled"),
  available: z.string().optional().describe("Availability of Zabbix agent"),
  description: z.string().optional(),
  groups: z.array(z.object({ groupid: z.string(), name: z.string() }))
    .optional(),
});

const HostsOutputSchema = z.object({
  hosts: z.array(HostSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const HostInterfaceSchema = z.object({
  interfaceid: z.string(),
  ip: z.string(),
  dns: z.string(),
  port: z.string(),
  type: z.string().describe("1=agent, 2=SNMP, 3=IPMI, 4=JMX"),
  main: z.string(),
});

const HostDetailSchema = z.object({
  host: HostSchema,
  interfaces: z.array(HostInterfaceSchema),
  macros: z.array(
    z.object({ macro: z.string(), value: z.string().optional() }),
  ),
  inventory: z.record(z.string()).optional(),
  fetchedAt: z.string(),
});

const ProblemSchema = z.object({
  eventid: z.string(),
  objectid: z.string(),
  name: z.string(),
  severity: z.string().describe(
    "0=not classified, 1=info, 2=warning, 3=average, 4=high, 5=disaster",
  ),
  acknowledged: z.string().describe("0=no, 1=yes"),
  clock: z.string(),
  hosts: z.array(z.object({ hostid: z.string(), name: z.string() })).optional(),
});

const ProblemsOutputSchema = z.object({
  problems: z.array(ProblemSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const TriggerSchema = z.object({
  triggerid: z.string(),
  description: z.string(),
  expression: z.string(),
  priority: z.string(),
  status: z.string().describe("0=enabled, 1=disabled"),
  value: z.string().describe("0=OK, 1=PROBLEM"),
  lastchange: z.string(),
  hosts: z.array(z.object({ hostid: z.string(), name: z.string() })).optional(),
});

const TriggersOutputSchema = z.object({
  triggers: z.array(TriggerSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const ItemSchema = z.object({
  itemid: z.string(),
  name: z.string(),
  key_: z.string(),
  type: z.string(),
  value_type: z.string().describe(
    "0=float, 1=character, 2=log, 3=unsigned, 4=text",
  ),
  lastvalue: z.string().optional(),
  lastclock: z.string().optional(),
  units: z.string().optional(),
  status: z.string().describe("0=enabled, 1=disabled"),
  state: z.string().optional().describe("0=normal, 1=not supported"),
});

const ItemsOutputSchema = z.object({
  hostid: z.string(),
  items: z.array(ItemSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const HistoryValueSchema = z.object({
  itemid: z.string(),
  clock: z.string(),
  value: z.string(),
  ns: z.string().optional(),
});

const HistoryOutputSchema = z.object({
  itemid: z.string(),
  history: z.array(HistoryValueSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const HostGroupSchema = z.object({
  groupid: z.string(),
  name: z.string(),
  flags: z.string().optional().describe("0=plain, 4=discovered"),
});

const HostGroupsOutputSchema = z.object({
  groups: z.array(HostGroupSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const MaintenanceSchema = z.object({
  maintenanceid: z.string(),
  name: z.string(),
  active_since: z.string(),
  active_till: z.string(),
  description: z.string().optional(),
  maintenance_type: z.string().describe("0=with data collection, 1=without"),
  hosts: z.array(z.object({ hostid: z.string(), name: z.string() })).optional(),
  groups: z.array(z.object({ groupid: z.string(), name: z.string() }))
    .optional(),
});

const MaintenanceOutputSchema = z.object({
  maintenances: z.array(MaintenanceSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const EventSchema = z.object({
  eventid: z.string(),
  source: z.string().describe(
    "0=trigger, 1=discovery, 2=autoregistration, 3=internal",
  ),
  object: z.string(),
  objectid: z.string(),
  clock: z.string(),
  value: z.string(),
  name: z.string().optional(),
  severity: z.string().optional(),
  acknowledged: z.string().optional(),
  hosts: z.array(z.object({ hostid: z.string(), name: z.string() })).optional(),
});

const EventsOutputSchema = z.object({
  events: z.array(EventSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const MapElementSchema = z.object({
  selementid: z.string(),
  elementtype: z.string().describe(
    "0=host, 1=map, 2=trigger, 3=host group, 4=image",
  ),
  label: z.string().optional(),
  elementid: z.string().describe(
    "ID of the linked object (hostid, groupid, etc.)",
  ),
  iconid_off: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
  hosts: z.array(z.object({ hostid: z.string(), name: z.string() })).optional(),
});

const MapLinkSchema = z.object({
  linkid: z.string(),
  selementid1: z.string(),
  selementid2: z.string(),
  color: z.string().optional(),
  drawtype: z.string().optional().describe(
    "0=line, 2=bold line, 3=dot, 4=dashed line",
  ),
  label: z.string().optional(),
});

const MapOutputSchema = z.object({
  sysmapid: z.string(),
  name: z.string(),
  width: z.string().optional(),
  height: z.string().optional(),
  selements: z.array(MapElementSchema),
  links: z.array(MapLinkSchema),
  totalElements: z.number(),
  totalLinks: z.number(),
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

let requestId = 0;

/** Make a JSON-RPC 2.0 request to the Zabbix API. */
async function zabbixRpc(
  baseUrl: string,
  apiToken: string,
  method: string,
  params: Record<string, unknown>,
  caCert?: string,
): Promise<unknown> {
  requestId += 1;
  const url = `${baseUrl.replace(/\/+$/, "")}/api_jsonrpc.php`;

  // deno-lint-ignore no-explicit-any
  const fetchOptions: any = {
    method: "POST",
    headers: {
      "Content-Type": "application/json-rpc",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: requestId,
    }),
  };

  // When a custom CA certificate is provided, create an HTTP client that trusts it.
  // Swamp runs extensions in a Deno runtime.
  if (caCert) {
    // deno-lint-ignore no-explicit-any
    const Deno_: any = (globalThis as any).Deno;
    if (Deno_?.createHttpClient) {
      fetchOptions.client = Deno_.createHttpClient({
        caCerts: [caCert],
      });
    }
  }

  const resp = await fetch(url, fetchOptions);

  if (!resp.ok) {
    const body = await resp.text().catch(() => "[unreadable]");
    throw new Error(`Zabbix API HTTP ${resp.status}: ${body}`);
  }

  const json = await resp.json() as {
    result?: unknown;
    error?: { code: number; message: string; data: string };
  };

  if (json.error) {
    throw new Error(
      `Zabbix API error ${json.error.code}: ${json.error.message} — ${json.error.data}`,
    );
  }

  return json.result;
}

// =============================================================================
// Model Definition
// =============================================================================

/** Zabbix read-only integration for monitoring and troubleshooting. */
export const model = {
  type: "@figura/zabbix",
  version: "2026.07.20.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    hosts: {
      description: "Monitored hosts with status and host groups",
      schema: HostsOutputSchema,
      lifetime: "10m" as const,
      garbageCollection: 5,
    },
    host_detail: {
      description:
        "Detailed host info including interfaces, macros, and inventory",
      schema: HostDetailSchema,
      lifetime: "10m" as const,
      garbageCollection: 10,
    },
    problems: {
      description: "Active problems/alerts with severity",
      schema: ProblemsOutputSchema,
      lifetime: "5m" as const,
      garbageCollection: 5,
    },
    triggers: {
      description: "Triggers with state and associated hosts",
      schema: TriggersOutputSchema,
      lifetime: "10m" as const,
      garbageCollection: 5,
    },
    items: {
      description: "Monitoring items (metrics) for a host",
      schema: ItemsOutputSchema,
      lifetime: "10m" as const,
      garbageCollection: 10,
    },
    history: {
      description: "Recent history values for an item",
      schema: HistoryOutputSchema,
      lifetime: "5m" as const,
      garbageCollection: 10,
    },
    host_groups: {
      description: "All host groups",
      schema: HostGroupsOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 5,
    },
    maintenance: {
      description: "Active and upcoming maintenance windows",
      schema: MaintenanceOutputSchema,
      lifetime: "10m" as const,
      garbageCollection: 5,
    },
    events: {
      description: "Recent events (state changes, alerts)",
      schema: EventsOutputSchema,
      lifetime: "5m" as const,
      garbageCollection: 10,
    },
    map: {
      description:
        "Zabbix network map with elements (hosts, groups, images) and links",
      schema: MapOutputSchema,
      lifetime: "10m" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    get_hosts: {
      description:
        "List monitored hosts with their status, availability, and host group membership. Optionally filter by group or search by name.",
      arguments: z.object({
        groupIds: z.array(z.string()).optional().describe(
          "Filter by host group IDs",
        ),
        search: z.string().optional().describe(
          "Search hosts by name (partial match)",
        ),
        limit: z.number().optional().describe(
          "Max hosts to return (default 100)",
        ),
      }),
      execute: async (
        args: { groupIds?: string[]; search?: string; limit?: number },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          output: [
            "hostid",
            "host",
            "name",
            "status",
            "available",
            "description",
          ],
          selectGroups: ["groupid", "name"],
          sortfield: "name",
          limit: args.limit ?? 100,
        };
        if (args.groupIds?.length) {
          params.groupids = args.groupIds;
        }
        if (args.search) {
          params.search = { name: args.search };
          params.searchWildcardsEnabled = true;
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "host.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const hosts = result.map((h: any) => ({
          hostid: h.hostid,
          host: h.host,
          name: h.name,
          status: h.status,
          available: h.available ?? undefined,
          description: h.description || undefined,
          groups: h.groups ?? undefined,
        }));

        const data = {
          hosts,
          totalCount: hosts.length,
          fetchedAt: new Date().toISOString(),
        };

        const instanceName = args.search
          ? `hosts-search-${args.search}`
          : args.groupIds?.length
          ? `hosts-group-${args.groupIds.join(",")}`
          : "hosts-all";

        const handle = await context.writeResource("hosts", instanceName, data);
        context.logger.info("Fetched Zabbix hosts", { count: hosts.length });
        return { dataHandles: [handle] };
      },
    },

    get_host_detail: {
      description:
        "Get detailed information for a specific host including interfaces, macros, and inventory data.",
      arguments: z.object({
        hostId: z.string().describe("Host ID to get details for"),
      }),
      execute: async (
        args: { hostId: string },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const result = await zabbixRpc(baseUrl, apiToken, "host.get", {
          hostids: [args.hostId],
          output: [
            "hostid",
            "host",
            "name",
            "status",
            "available",
            "description",
          ],
          selectGroups: ["groupid", "name"],
          selectInterfaces: [
            "interfaceid",
            "ip",
            "dns",
            "port",
            "type",
            "main",
          ],
          selectMacros: ["macro", "value"],
          selectInventory: "extend",
        }, caCert) as unknown[];

        if (!result.length) {
          throw new Error(`Host '${args.hostId}' not found`);
        }

        // deno-lint-ignore no-explicit-any
        const h = result[0] as any;
        const data = {
          host: {
            hostid: h.hostid,
            host: h.host,
            name: h.name,
            status: h.status,
            available: h.available ?? undefined,
            description: h.description || undefined,
            groups: h.groups ?? undefined,
          },
          interfaces: h.interfaces ?? [],
          macros: h.macros ?? [],
          inventory: h.inventory && Object.keys(h.inventory).length
            ? h.inventory
            : undefined,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "host_detail",
          `host-${args.hostId}`,
          data,
        );
        context.logger.info("Fetched Zabbix host detail", {
          hostId: args.hostId,
          name: h.name,
        });
        return { dataHandles: [handle] };
      },
    },

    get_problems: {
      description:
        "List active problems/alerts with severity, acknowledgment status, and affected hosts. Optionally filter by severity or host.",
      arguments: z.object({
        hostIds: z.array(z.string()).optional().describe(
          "Filter problems by host IDs",
        ),
        severities: z.array(z.number()).optional().describe(
          "Filter by severities (0-5). E.g. [4,5] for high+disaster",
        ),
        limit: z.number().optional().describe(
          "Max problems to return (default 100)",
        ),
        acknowledged: z.boolean().optional().describe(
          "Filter: true=only ack'd, false=only unack'd, omit=all",
        ),
      }),
      execute: async (
        args: {
          hostIds?: string[];
          severities?: number[];
          limit?: number;
          acknowledged?: boolean;
        },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          output: [
            "eventid",
            "objectid",
            "name",
            "severity",
            "acknowledged",
            "clock",
          ],
          sortfield: ["eventid"],
          sortorder: "DESC",
          recent: true,
          limit: args.limit ?? 100,
        };
        if (args.hostIds?.length) {
          params.hostids = args.hostIds;
        }
        if (args.severities?.length) {
          params.severities = args.severities;
        }
        if (args.acknowledged !== undefined) {
          params.acknowledged = args.acknowledged;
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "problem.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const problems = result.map((p: any) => ({
          eventid: p.eventid,
          objectid: p.objectid,
          name: p.name,
          severity: p.severity,
          acknowledged: p.acknowledged,
          clock: p.clock,
          hosts: p.hosts ?? undefined,
        }));

        const data = {
          problems,
          totalCount: problems.length,
          fetchedAt: new Date().toISOString(),
        };

        const instanceName = args.hostIds?.length
          ? `problems-hosts-${args.hostIds.join(",")}`
          : "problems-active";

        const handle = await context.writeResource(
          "problems",
          instanceName,
          data,
        );
        context.logger.info("Fetched Zabbix problems", {
          count: problems.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_triggers: {
      description:
        "List triggers with their current state, priority, and associated hosts. Optionally filter by host or show only triggers in PROBLEM state.",
      arguments: z.object({
        hostIds: z.array(z.string()).optional().describe(
          "Filter triggers by host IDs",
        ),
        onlyProblems: z.boolean().optional().describe(
          "If true, only return triggers in PROBLEM state",
        ),
        limit: z.number().optional().describe(
          "Max triggers to return (default 100)",
        ),
      }),
      execute: async (
        args: { hostIds?: string[]; onlyProblems?: boolean; limit?: number },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          output: [
            "triggerid",
            "description",
            "expression",
            "priority",
            "status",
            "value",
            "lastchange",
          ],
          selectHosts: ["hostid", "name"],
          sortfield: "lastchange",
          sortorder: "DESC",
          limit: args.limit ?? 100,
        };
        if (args.hostIds?.length) {
          params.hostids = args.hostIds;
        }
        if (args.onlyProblems) {
          params.filter = { value: 1 };
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "trigger.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const triggers = result.map((t: any) => ({
          triggerid: t.triggerid,
          description: t.description,
          expression: t.expression,
          priority: t.priority,
          status: t.status,
          value: t.value,
          lastchange: t.lastchange,
          hosts: t.hosts ?? undefined,
        }));

        const data = {
          triggers,
          totalCount: triggers.length,
          fetchedAt: new Date().toISOString(),
        };

        const instanceName = args.hostIds?.length
          ? `triggers-hosts-${args.hostIds.join(",")}`
          : args.onlyProblems
          ? "triggers-problems"
          : "triggers-all";

        const handle = await context.writeResource(
          "triggers",
          instanceName,
          data,
        );
        context.logger.info("Fetched Zabbix triggers", {
          count: triggers.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_items: {
      description:
        "List monitoring items (metrics) for a specific host. Shows item name, key, last value, and status.",
      arguments: z.object({
        hostId: z.string().describe("Host ID to get items for"),
        search: z.string().optional().describe(
          "Search items by name or key (partial match)",
        ),
        limit: z.number().optional().describe(
          "Max items to return (default 100)",
        ),
      }),
      execute: async (
        args: { hostId: string; search?: string; limit?: number },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          hostids: [args.hostId],
          output: [
            "itemid",
            "name",
            "key_",
            "type",
            "value_type",
            "lastvalue",
            "lastclock",
            "units",
            "status",
            "state",
          ],
          sortfield: "name",
          limit: args.limit ?? 100,
        };
        if (args.search) {
          params.search = { name: args.search, key_: args.search };
          params.searchByAny = true;
          params.searchWildcardsEnabled = true;
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "item.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const items = result.map((i: any) => ({
          itemid: i.itemid,
          name: i.name,
          key_: i.key_,
          type: i.type,
          value_type: i.value_type,
          lastvalue: i.lastvalue ?? undefined,
          lastclock: i.lastclock ?? undefined,
          units: i.units || undefined,
          status: i.status,
          state: i.state ?? undefined,
        }));

        const data = {
          hostid: args.hostId,
          items,
          totalCount: items.length,
          fetchedAt: new Date().toISOString(),
        };

        const instanceName = args.search
          ? `items-${args.hostId}-${args.search}`
          : `items-${args.hostId}`;

        const handle = await context.writeResource("items", instanceName, data);
        context.logger.info("Fetched Zabbix items", {
          hostId: args.hostId,
          count: items.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_history: {
      description:
        "Get recent history/metric values for a specific item. Useful for checking recent metric trends.",
      arguments: z.object({
        itemId: z.string().describe("Item ID to get history for"),
        valueType: z.number().optional().describe(
          "Value type: 0=float, 1=character, 2=log, 3=unsigned, 4=text. If omitted, defaults to 0 (float)",
        ),
        limit: z.number().optional().describe(
          "Max history records to return (default 50)",
        ),
        timeFrom: z.number().optional().describe(
          "Unix timestamp — only return values after this time",
        ),
      }),
      execute: async (
        args: {
          itemId: string;
          valueType?: number;
          limit?: number;
          timeFrom?: number;
        },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          itemids: [args.itemId],
          output: "extend",
          sortfield: "clock",
          sortorder: "DESC",
          history: args.valueType ?? 0,
          limit: args.limit ?? 50,
        };
        if (args.timeFrom) {
          params.time_from = args.timeFrom;
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "history.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const history = result.map((h: any) => ({
          itemid: h.itemid,
          clock: h.clock,
          value: h.value,
          ns: h.ns ?? undefined,
        }));

        const data = {
          itemid: args.itemId,
          history,
          totalCount: history.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "history",
          `history-${args.itemId}`,
          data,
        );
        context.logger.info("Fetched Zabbix history", {
          itemId: args.itemId,
          count: history.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_host_groups: {
      description: "List all host groups in Zabbix.",
      arguments: z.object({
        search: z.string().optional().describe(
          "Search groups by name (partial match)",
        ),
      }),
      execute: async (
        args: { search?: string },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          output: ["groupid", "name", "flags"],
          sortfield: "name",
        };
        if (args.search) {
          params.search = { name: args.search };
          params.searchWildcardsEnabled = true;
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "hostgroup.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const groups = result.map((g: any) => ({
          groupid: g.groupid,
          name: g.name,
          flags: g.flags ?? undefined,
        }));

        const data = {
          groups,
          totalCount: groups.length,
          fetchedAt: new Date().toISOString(),
        };

        const instanceName = args.search
          ? `groups-${args.search}`
          : "groups-all";
        const handle = await context.writeResource(
          "host_groups",
          instanceName,
          data,
        );
        context.logger.info("Fetched Zabbix host groups", {
          count: groups.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_maintenance: {
      description:
        "List active and upcoming maintenance windows with their time periods and associated hosts/groups.",
      arguments: z.object({
        hostIds: z.array(z.string()).optional().describe(
          "Filter maintenance windows by host IDs",
        ),
        groupIds: z.array(z.string()).optional().describe(
          "Filter maintenance windows by host group IDs",
        ),
      }),
      execute: async (
        args: { hostIds?: string[]; groupIds?: string[] },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          output: [
            "maintenanceid",
            "name",
            "active_since",
            "active_till",
            "description",
            "maintenance_type",
          ],
          selectHosts: ["hostid", "name"],
          selectGroups: ["groupid", "name"],
          sortfield: "active_since",
          sortorder: "DESC",
        };
        if (args.hostIds?.length) {
          params.hostids = args.hostIds;
        }
        if (args.groupIds?.length) {
          params.groupids = args.groupIds;
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "maintenance.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const maintenances = result.map((m: any) => ({
          maintenanceid: m.maintenanceid,
          name: m.name,
          active_since: m.active_since,
          active_till: m.active_till,
          description: m.description || undefined,
          maintenance_type: m.maintenance_type,
          hosts: m.hosts?.length ? m.hosts : undefined,
          groups: m.groups?.length ? m.groups : undefined,
        }));

        const data = {
          maintenances,
          totalCount: maintenances.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "maintenance",
          "maintenance-all",
          data,
        );
        context.logger.info("Fetched Zabbix maintenance windows", {
          count: maintenances.length,
        });
        return { dataHandles: [handle] };
      },
    },

    get_events: {
      description:
        "Get recent events (trigger state changes, alerts). Useful for investigating incident timelines.",
      arguments: z.object({
        hostIds: z.array(z.string()).optional().describe(
          "Filter events by host IDs",
        ),
        objectIds: z.array(z.string()).optional().describe(
          "Filter events by trigger IDs (objectids)",
        ),
        severities: z.array(z.number()).optional().describe(
          "Filter by severities (0-5)",
        ),
        timeFrom: z.number().optional().describe(
          "Unix timestamp — only return events after this time",
        ),
        limit: z.number().optional().describe(
          "Max events to return (default 100)",
        ),
      }),
      execute: async (
        args: {
          hostIds?: string[];
          objectIds?: string[];
          severities?: number[];
          timeFrom?: number;
          limit?: number;
        },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;
        const params: Record<string, unknown> = {
          output: [
            "eventid",
            "source",
            "object",
            "objectid",
            "clock",
            "value",
            "name",
            "severity",
            "acknowledged",
          ],
          selectHosts: ["hostid", "name"],
          sortfield: ["clock", "eventid"],
          sortorder: "DESC",
          limit: args.limit ?? 100,
        };
        if (args.hostIds?.length) {
          params.hostids = args.hostIds;
        }
        if (args.objectIds?.length) {
          params.objectids = args.objectIds;
        }
        if (args.severities?.length) {
          params.severities = args.severities;
        }
        if (args.timeFrom) {
          params.time_from = args.timeFrom;
        }

        const result = await zabbixRpc(
          baseUrl,
          apiToken,
          "event.get",
          params,
          caCert,
        ) as unknown[];

        // deno-lint-ignore no-explicit-any
        const events = result.map((e: any) => ({
          eventid: e.eventid,
          source: e.source,
          object: e.object,
          objectid: e.objectid,
          clock: e.clock,
          value: e.value,
          name: e.name || undefined,
          severity: e.severity ?? undefined,
          acknowledged: e.acknowledged ?? undefined,
          hosts: e.hosts?.length ? e.hosts : undefined,
        }));

        const data = {
          events,
          totalCount: events.length,
          fetchedAt: new Date().toISOString(),
        };

        const instanceName = args.hostIds?.length
          ? `events-hosts-${args.hostIds.join(",")}`
          : args.objectIds?.length
          ? `events-triggers-${args.objectIds.join(",")}`
          : "events-recent";

        const handle = await context.writeResource(
          "events",
          instanceName,
          data,
        );
        context.logger.info("Fetched Zabbix events", { count: events.length });
        return { dataHandles: [handle] };
      },
    },

    get_map: {
      description:
        "Retrieve a Zabbix network map by its sysmap ID, including all elements (hosts, groups, images, triggers) and links between them.",
      arguments: z.object({
        sysmapId: z.string().describe("The sysmap ID to retrieve"),
      }),
      execute: async (
        args: { sysmapId: string },
        context: ModelContext,
      ) => {
        const { baseUrl, apiToken, caCert } = context.globalArgs;

        // Fetch map with elements and links.
        const result = await zabbixRpc(baseUrl, apiToken, "map.get", {
          sysmapids: [args.sysmapId],
          output: "extend",
          selectSelements: "extend",
          selectLinks: "extend",
        }, caCert) as unknown[];

        if (!result.length) {
          throw new Error(`Map with sysmapid '${args.sysmapId}' not found`);
        }

        // deno-lint-ignore no-explicit-any
        const m = result[0] as any;

        // Zabbix <7.0 uses "selements", 7.0+ may also use "elements" at map level
        const rawElements = m.selements ?? m.elements ?? [];

        // In Zabbix 7.x, host references are nested inside each selement:
        //   selement.elements = [{ hostid: "..." }]
        // In Zabbix <7.0, the host ID is a flat field:
        //   selement.elementid = "..."
        // deno-lint-ignore no-explicit-any
        const getHostId = (s: any): string | undefined => {
          if (s.elementtype !== "0") return undefined;
          // Zabbix 7.x: nested elements array with hostid
          if (
            Array.isArray(s.elements) && s.elements.length > 0 &&
            s.elements[0]?.hostid
          ) {
            return s.elements[0].hostid;
          }
          // Zabbix <7.0: flat elementid
          if (s.elementid && s.elementid !== "0") {
            return s.elementid;
          }
          return undefined;
        };

        // Collect host IDs from host-type elements
        const hostElementIds = rawElements
          // deno-lint-ignore no-explicit-any
          .map((s: any) => getHostId(s))
          .filter((id: string | undefined): id is string => !!id);

        // Resolve host names
        let hostNameMap: Record<string, string> = {};
        if (hostElementIds.length) {
          const hosts = await zabbixRpc(baseUrl, apiToken, "host.get", {
            hostids: hostElementIds,
            output: ["hostid", "name"],
          }, caCert) as unknown[];
          hostNameMap = Object.fromEntries(
            // deno-lint-ignore no-explicit-any
            (hosts as any[]).map((h: any) => [h.hostid, h.name]),
          );
        }

        // deno-lint-ignore no-explicit-any
        const selements = rawElements.map((s: any) => {
          const hostId = getHostId(s);
          return {
            selementid: s.selementid,
            elementtype: s.elementtype,
            label: s.label || undefined,
            elementid: hostId ?? s.elementid ?? "0",
            iconid_off: s.iconid_off || undefined,
            x: s.x ?? undefined,
            y: s.y ?? undefined,
            hosts: hostId && hostNameMap[hostId]
              ? [{ hostid: hostId, name: hostNameMap[hostId] }]
              : undefined,
          };
        });

        // deno-lint-invoke no-explicit-any
        const links = (m.links ?? []).map(
          // deno-lint-ignore no-explicit-any
          (l: any) => ({
            linkid: l.linkid,
            selementid1: l.selementid1,
            selementid2: l.selementid2,
            color: l.color || undefined,
            drawtype: l.drawtype ?? undefined,
            label: l.label || undefined,
          }),
        );

        const data = {
          sysmapid: m.sysmapid,
          name: m.name,
          width: m.width ?? undefined,
          height: m.height ?? undefined,
          selements,
          links,
          totalElements: selements.length,
          totalLinks: links.length,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "map",
          `map-${args.sysmapId}`,
          data,
        );
        context.logger.info("Fetched Zabbix map", {
          sysmapId: args.sysmapId,
          name: m.name,
          elements: selements.length,
          links: links.length,
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
