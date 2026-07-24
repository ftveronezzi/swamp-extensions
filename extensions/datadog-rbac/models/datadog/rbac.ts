/**
 * Datadog RBAC — role, permission, user, and restriction query analysis
 *
 * Wraps the Datadog RBAC API (v2) for analyzing who has access to what
 * data (logs, traces, RUM, etc.) via roles, permissions, and restriction queries.
 *
 * @module
 */
// SPDX-License-Identifier: MIT

import { z } from "npm:zod@4.4.3";
// Using custom helpers instead of shared ddApi for paginated RBAC endpoints

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

const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  user_count: z.number().optional(),
  permissions: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
  })).optional(),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
});

const UserSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  status: z.string().optional(),
  disabled: z.boolean().optional(),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
  })).optional(),
});

const PermissionSchema = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  group_name: z.string().optional(),
  restricted: z.boolean().optional(),
});

const RestrictionQuerySchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  restriction_query: z.string().optional(),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
  })).optional(),
});

const ListRolesSchema = z.object({
  items: z.array(RoleSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const ListUsersSchema = z.object({
  items: z.array(UserSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const ListPermissionsSchema = z.object({
  items: z.array(PermissionSchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const ListRestrictionQueriesSchema = z.object({
  items: z.array(RestrictionQuerySchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
});

const AnalyzeAccessSchema = z.object({
  target: z.string(),
  targetType: z.string(),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })),
  permissions: z.array(z.object({
    id: z.string(),
    name: z.string(),
    group_name: z.string().optional(),
  })),
  restrictionQueries: z.array(z.object({
    dataType: z.string(),
    query: z.string(),
    roleId: z.string(),
    roleName: z.string().optional(),
  })),
  effectiveAccess: z.record(z.string(), z.string()),
  analyzedAt: z.string(),
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

interface FlatItem {
  id: string;
  [key: string]: unknown;
}

async function ddGetPaginated(
  apiKey: string,
  appKey: string,
  site: string,
  path: string,
  pageSize = 100,
): Promise<FlatItem[]> {
  const baseUrl = DD_SITES[site] ?? DD_SITES.us1;
  const allResults: FlatItem[] = [];
  let pageNumber = 0;
  const maxPages = 50;

  const headers: Record<string, string> = {
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": appKey,
    "Accept": "application/json",
  };

  while (pageNumber < maxPages) {
    const separator = path.includes("?") ? "&" : "?";
    const url =
      `${baseUrl}${path}${separator}page[size]=${pageSize}&page[number]=${pageNumber}`;

    let response = await fetch(url, { method: "GET", headers });

    if (response.status === 429) {
      const retryAfter = Math.min(
        parseInt(response.headers.get("Retry-After") ?? "5", 10),
        60,
      );
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      response = await fetch(url, { method: "GET", headers });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Datadog API 429 after retry: ${text.slice(0, 300)}`);
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Datadog API HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    const json = await response.json() as Record<string, unknown>;
    const data = json.data;

    if (!Array.isArray(data) || data.length === 0) break;

    for (const item of data) {
      if (item && typeof item === "object") {
        const i = item as Record<string, unknown>;
        const flat: FlatItem = { id: String(i.id ?? "") };
        if (i.attributes && typeof i.attributes === "object") {
          Object.assign(flat, i.attributes as Record<string, unknown>);
        }
        if (i.relationships && typeof i.relationships === "object") {
          flat._relationships = i.relationships;
        }
        allResults.push(flat);
      }
    }

    // Check if there's more data
    const meta = json.meta as Record<string, unknown> | undefined;
    const page = meta?.page as Record<string, unknown> | undefined;
    const totalCount = page?.total_count as number | undefined;

    if (totalCount !== undefined && allResults.length >= totalCount) break;
    if (data.length < pageSize) break;

    pageNumber++;
  }

  return allResults;
}

async function ddGetSimple(
  apiKey: string,
  appKey: string,
  site: string,
  path: string,
): Promise<FlatItem[]> {
  const baseUrl = DD_SITES[site] ?? DD_SITES.us1;
  const headers: Record<string, string> = {
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": appKey,
    "Accept": "application/json",
  };

  let response = await fetch(`${baseUrl}${path}`, { method: "GET", headers });

  if (response.status === 429) {
    const retryAfter = Math.min(
      parseInt(response.headers.get("Retry-After") ?? "5", 10),
      60,
    );
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    response = await fetch(`${baseUrl}${path}`, { method: "GET", headers });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Datadog API HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  const json = await response.json() as Record<string, unknown>;
  const data = json.data;

  if (!Array.isArray(data)) return [];

  return data.map((item: unknown) => {
    const i = item as Record<string, unknown>;
    const flat: FlatItem = { id: String(i.id ?? "") };
    if (i.attributes && typeof i.attributes === "object") {
      Object.assign(flat, i.attributes as Record<string, unknown>);
    }
    if (i.relationships && typeof i.relationships === "object") {
      flat._relationships = i.relationships;
    }
    return flat;
  });
}

// =============================================================================
// Model Definition
// =============================================================================

/** Datadog RBAC — role, permission, user, and restriction query analysis */
export const model = {
  type: "@figura/datadog/rbac",
  version: "2026.07.24.1",
  globalArguments: GlobalArgsSchema,

  upgrades: [],

  resources: {
    "roles": {
      description: "All roles with permissions",
      schema: ListRolesSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    "users": {
      description: "All users with role assignments",
      schema: ListUsersSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    "permissions": {
      description: "Full permission catalog",
      schema: ListPermissionsSchema,
      lifetime: "infinite" as const,
      garbageCollection: 5,
    },
    "restriction_queries": {
      description: "Restriction queries for data access control",
      schema: ListRestrictionQueriesSchema,
      lifetime: "infinite" as const,
      garbageCollection: 10,
    },
    "access_analysis": {
      description: "Effective access analysis for a user or role",
      schema: AnalyzeAccessSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
  },

  methods: {
    list_roles: {
      description: "List all roles in the org with their assigned permissions",
      arguments: z.object({
        include_permissions: z.boolean().optional().default(true).describe(
          "Whether to fetch permissions for each role (default: true)",
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
        const includePerms = args.include_permissions !== false;

        const roles = await ddGetPaginated(
          apiKey,
          appKey,
          site,
          "/api/v2/roles",
        );

        const items = [];
        for (const role of roles) {
          const item: Record<string, unknown> = {
            id: role.id,
            name: role.name,
            user_count: role.user_count,
            created_at: role.created_at,
            modified_at: role.modified_at,
          };

          if (includePerms) {
            const perms = await ddGetSimple(
              apiKey,
              appKey,
              site,
              `/api/v2/roles/${role.id}/permissions`,
            );
            item.permissions = perms.map((p) => ({
              id: p.id,
              name: p.name ?? p.id,
            }));
          }

          items.push(item);
        }

        const handle = await context.writeResource("roles", "latest", {
          items,
          totalCount: items.length,
          fetchedAt: new Date().toISOString(),
        });

        context.logger.info("Found {count} roles", { count: items.length });
        return { dataHandles: [handle] };
      },
    },

    list_users: {
      description: "List all users with their role assignments",
      arguments: z.object({
        filter_status: z.string().optional().describe(
          "Filter by status (Active, Pending, Disabled). Default: all.",
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

        let path = "/api/v2/users";
        if (args.filter_status) {
          path += `?filter[status]=${args.filter_status}`;
        }

        const users = await ddGetPaginated(apiKey, appKey, site, path);

        const items = users.map((u) => {
          const rels = u._relationships as Record<string, unknown> | undefined;
          const rolesRel = rels?.roles as Record<string, unknown> | undefined;
          const rolesData = rolesRel?.data as
            | Array<Record<string, unknown>>
            | undefined;

          return {
            id: u.id,
            email: u.email,
            name: u.name,
            handle: u.handle,
            status: u.status,
            disabled: u.disabled,
            roles: rolesData?.map((r) => ({
              id: String(r.id),
              name: undefined as string | undefined,
            })) ?? [],
          };
        });

        const handle = await context.writeResource("users", "latest", {
          items,
          totalCount: items.length,
          fetchedAt: new Date().toISOString(),
        });

        context.logger.info("Found {count} users", { count: items.length });
        return { dataHandles: [handle] };
      },
    },

    list_permissions: {
      description:
        "List the full permission catalog — all available permissions and their groups",
      arguments: z.object({}),
      execute: async (
        _args: Record<string, unknown>,
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

        const perms = await ddGetSimple(
          apiKey,
          appKey,
          site,
          "/api/v2/permissions",
        );

        const items = perms.map((p) => ({
          id: p.id,
          name: p.name as string,
          display_name: p.display_name as string | undefined,
          description: p.description as string | undefined,
          group_name: p.group_name as string | undefined,
          restricted: p.restricted as boolean | undefined,
        }));

        const handle = await context.writeResource("permissions", "latest", {
          items,
          totalCount: items.length,
          fetchedAt: new Date().toISOString(),
        });

        context.logger.info("Found {count} permissions", {
          count: items.length,
        });
        return { dataHandles: [handle] };
      },
    },

    list_restriction_queries: {
      description:
        "List restriction queries — dataset-level filters that control who sees what logs/traces/events",
      arguments: z.object({
        data_type: z.enum(["logs", "events", "spans", "rum"]).optional()
          .describe(
            "Filter by data type. If omitted, fetches all types.",
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

        const dataTypes = args.data_type
          ? [args.data_type as string]
          : ["logs", "events", "spans", "rum"];

        const allItems: Record<string, unknown>[] = [];

        for (const dt of dataTypes) {
          const path = `/api/v2/${dt}/config/restriction_queries`;
          try {
            const queries = await ddGetSimple(apiKey, appKey, site, path);

            for (const q of queries) {
              // Fetch roles for this restriction query
              let roles: { id: string; name?: string }[] = [];
              try {
                const rolesData = await ddGetSimple(
                  apiKey,
                  appKey,
                  site,
                  `${path}/${q.id}/roles`,
                );
                roles = rolesData.map((r) => ({
                  id: r.id,
                  name: r.name as string | undefined,
                }));
              } catch {
                // Some restriction queries may not have roles endpoint
              }

              allItems.push({
                id: q.id,
                type: dt,
                restriction_query: q.restriction_query ?? q.query,
                created_at: q.created_at,
                modified_at: q.modified_at,
                roles,
              });
            }
          } catch (err) {
            // Some data types may not support restriction queries
            context.logger.info(
              "Skipping {dataType}: {error}",
              { dataType: dt, error: String(err).slice(0, 100) },
            );
          }
        }

        const handle = await context.writeResource(
          "restriction_queries",
          "latest",
          {
            items: allItems,
            totalCount: allItems.length,
            fetchedAt: new Date().toISOString(),
          },
        );

        context.logger.info("Found {count} restriction queries", {
          count: allItems.length,
        });
        return { dataHandles: [handle] };
      },
    },

    analyze_access: {
      description:
        "Analyze effective access for a user (by email) or role (by name). Resolves the full chain: user → roles → permissions + restriction queries → what data they can see.",
      arguments: z.object({
        user_email: z.string().optional().describe(
          "User email to analyze. Mutually exclusive with role_name.",
        ),
        role_name: z.string().optional().describe(
          "Role name to analyze. Mutually exclusive with user_email.",
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
        const userEmail = args.user_email as string | undefined;
        const roleName = args.role_name as string | undefined;

        if (!userEmail && !roleName) {
          throw new Error(
            "Either user_email or role_name must be provided",
          );
        }

        // 1. Get all permissions catalog for name resolution
        const permsCatalog = await ddGetSimple(
          apiKey,
          appKey,
          site,
          "/api/v2/permissions",
        );
        const permMap = new Map<string, FlatItem>();
        for (const p of permsCatalog) permMap.set(p.id, p);

        // 2. Get all roles
        const allRoles = await ddGetPaginated(
          apiKey,
          appKey,
          site,
          "/api/v2/roles",
        );
        const roleMap = new Map<string, FlatItem>();
        for (const r of allRoles) roleMap.set(r.id, r);

        // 3. Determine target roles
        let targetRoles: { id: string; name: string }[] = [];
        let targetName = "";
        let targetType = "";

        if (userEmail) {
          targetType = "user";
          targetName = userEmail;

          // Find user
          const users = await ddGetPaginated(
            apiKey,
            appKey,
            site,
            `/api/v2/users?filter=${encodeURIComponent(userEmail)}`,
          );
          const user = users.find(
            (u) =>
              (u.email as string)?.toLowerCase().includes(
                userEmail.toLowerCase(),
              ) ||
              (u.handle as string)?.toLowerCase().includes(
                userEmail.toLowerCase(),
              ) ||
              (u.name as string)?.toLowerCase().includes(
                userEmail.toLowerCase(),
              ),
          );

          if (!user) {
            throw new Error(`User not found: ${userEmail}`);
          }

          // Resolve user's roles from relationships or by querying role membership
          const rels = user._relationships as
            | Record<string, unknown>
            | undefined;
          const rolesRel = rels?.roles as Record<string, unknown> | undefined;
          const rolesRelData = rolesRel?.data as
            | Array<Record<string, unknown>>
            | undefined;

          if (rolesRelData && rolesRelData.length > 0) {
            targetRoles = rolesRelData.map((r) => {
              const id = String(r.id);
              const role = roleMap.get(id);
              return { id, name: (role?.name as string) ?? id };
            });
          } else {
            // Fallback: check each role for this user
            for (const role of allRoles) {
              try {
                const roleUsers = await ddGetPaginated(
                  apiKey,
                  appKey,
                  site,
                  `/api/v2/roles/${role.id}/users`,
                );
                if (roleUsers.some((ru) => ru.id === user.id)) {
                  targetRoles.push({
                    id: role.id,
                    name: (role.name as string) ?? role.id,
                  });
                }
              } catch {
                // Skip roles we can't query
              }
            }
          }
        } else {
          targetType = "role";
          targetName = roleName!;

          const role = allRoles.find(
            (r) =>
              (r.name as string)?.toLowerCase() === roleName!.toLowerCase(),
          );
          if (!role) {
            throw new Error(`Role not found: ${roleName}`);
          }
          targetRoles = [{ id: role.id, name: role.name as string }];
        }

        // 4. Get permissions for each role
        const allPerms: { id: string; name: string; group_name?: string }[] =
          [];
        const seenPermIds = new Set<string>();

        for (const role of targetRoles) {
          const rolePerms = await ddGetSimple(
            apiKey,
            appKey,
            site,
            `/api/v2/roles/${role.id}/permissions`,
          );
          for (const p of rolePerms) {
            if (!seenPermIds.has(p.id)) {
              seenPermIds.add(p.id);
              const catalog = permMap.get(p.id);
              allPerms.push({
                id: p.id,
                name: (catalog?.name ?? p.name ?? p.id) as string,
                group_name: catalog?.group_name as string | undefined,
              });
            }
          }
        }

        // 5. Get restriction queries for all data types
        const dataTypes = ["logs", "events", "spans", "rum"];
        const restrictions: {
          dataType: string;
          query: string;
          roleId: string;
          roleName?: string;
        }[] = [];
        const effectiveAccess: Record<string, string> = {};
        const roleIds = new Set(targetRoles.map((r) => r.id));

        for (const dt of dataTypes) {
          try {
            const queries = await ddGetSimple(
              apiKey,
              appKey,
              site,
              `/api/v2/${dt}/config/restriction_queries`,
            );

            let hasRestriction = false;
            const dtQueries: string[] = [];

            for (const q of queries) {
              // Check if any of target roles are linked to this query
              try {
                const qRoles = await ddGetSimple(
                  apiKey,
                  appKey,
                  site,
                  `/api/v2/${dt}/config/restriction_queries/${q.id}/roles`,
                );
                for (const qr of qRoles) {
                  if (roleIds.has(qr.id)) {
                    const queryStr =
                      (q.restriction_query ?? q.query ?? "*") as string;
                    restrictions.push({
                      dataType: dt,
                      query: queryStr,
                      roleId: qr.id,
                      roleName: roleMap.get(qr.id)?.name as string | undefined,
                    });
                    hasRestriction = true;
                    if (queryStr !== "*") dtQueries.push(queryStr);
                  }
                }
              } catch {
                // Skip if roles endpoint not available
              }
            }

            if (!hasRestriction) {
              // Check if user has the read permission for this data type
              const readPermName = `${dt}_read_data`;
              const hasReadPerm = allPerms.some((p) =>
                p.name === readPermName ||
                p.name === `${dt}_read_index`
              );
              if (hasReadPerm) {
                effectiveAccess[dt] = "unrestricted (no restriction query)";
              } else {
                effectiveAccess[dt] = "no read permission";
              }
            } else if (dtQueries.length === 0) {
              effectiveAccess[dt] = "unrestricted (query: *)";
            } else {
              effectiveAccess[dt] = `restricted — ${dtQueries.join(" OR ")}`;
            }
          } catch {
            effectiveAccess[dt] = "unknown (API not available for this type)";
          }
        }

        const instanceName = (userEmail ?? roleName ?? "unknown")
          .replace(/[^a-zA-Z0-9_-]/g, "_");

        const result = {
          target: targetName,
          targetType,
          roles: targetRoles,
          permissions: allPerms,
          restrictionQueries: restrictions,
          effectiveAccess,
          analyzedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "access_analysis",
          instanceName,
          result,
        );

        context.logger.info(
          "Analyzed access for {target}: {roleCount} roles, {permCount} permissions, {rqCount} restrictions",
          {
            target: targetName,
            roleCount: targetRoles.length,
            permCount: allPerms.length,
            rqCount: restrictions.length,
          },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
