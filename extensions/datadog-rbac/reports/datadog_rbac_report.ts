/**
 * Datadog RBAC Report — Permission matrix and access analysis
 *
 * Produces:
 * - Markdown: Role/user permission matrix, restriction query breakdown, access gaps
 * - JSON: Structured data for agent consumption and automated audits
 *
 * @module
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface RoleItem {
  id: string;
  name: string;
  user_count?: number;
  permissions?: { id: string; name?: string }[];
  created_at?: string;
  modified_at?: string;
}

interface UserItem {
  id: string;
  email?: string;
  name?: string;
  handle?: string;
  status?: string;
  disabled?: boolean;
  roles?: { id: string; name?: string }[];
}

interface PermissionItem {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  group_name?: string;
  restricted?: boolean;
}

interface RestrictionQueryItem {
  id: string;
  type?: string;
  restriction_query?: string;
  created_at?: string;
  modified_at?: string;
  roles?: { id: string; name?: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  }
  return groups;
}

// ─── Report ───────────────────────────────────────────────────────────────────

export const report = {
  name: "@figura/datadog-rbac-report",
  description:
    "Datadog RBAC analysis — role/user permission matrix, restriction queries, and effective access overview",
  scope: "workflow" as const,
  labels: ["datadog", "rbac", "permissions", "security", "access-control"],
  execute: async (context: {
    workflowName: string;
    workflowStatus: string;
    stepExecutions: Array<{
      jobName: string;
      stepName: string;
      modelName: string;
      modelType: string;
      methodName: string;
      status: string;
      dataHandles: Array<{ name: string; version: number; specName: string }>;
      modelId: string;
    }>;
    dataRepository: {
      getContent: (
        type: string,
        modelId: string,
        dataName: string,
        version?: number,
      ) => Promise<Uint8Array | null>;
    };
  }) => {
    // Find relevant steps
    const rolesStep = context.stepExecutions.find(
      (s) => s.methodName === "list_roles" && s.status === "succeeded",
    );
    const usersStep = context.stepExecutions.find(
      (s) => s.methodName === "list_users" && s.status === "succeeded",
    );
    const permsStep = context.stepExecutions.find(
      (s) => s.methodName === "list_permissions" && s.status === "succeeded",
    );
    const rqStep = context.stepExecutions.find(
      (s) =>
        s.methodName === "list_restriction_queries" && s.status === "succeeded",
    );

    // Helper to read data from a step
    async function readStepData<T>(
      step: typeof rolesStep,
      specName: string,
    ): Promise<T | null> {
      if (!step) return null;
      const handle = step.dataHandles.find((h) => h.specName === specName);
      if (!handle) return null;
      const raw = await context.dataRepository.getContent(
        step.modelType,
        step.modelId,
        handle.name,
        handle.version,
      );
      if (!raw) return null;
      return JSON.parse(new TextDecoder().decode(raw)) as T;
    }

    // Load all data
    const rolesData = await readStepData<
      { items: RoleItem[]; fetchedAt: string }
    >(
      rolesStep,
      "roles",
    );
    const usersData = await readStepData<
      { items: UserItem[]; fetchedAt: string }
    >(
      usersStep,
      "users",
    );
    const permsData = await readStepData<
      { items: PermissionItem[]; fetchedAt: string }
    >(
      permsStep,
      "permissions",
    );
    const rqData = await readStepData<
      { items: RestrictionQueryItem[]; fetchedAt: string }
    >(
      rqStep,
      "restriction_queries",
    );

    if (!rolesData && !usersData && !rqData) {
      const md =
        "# ❌ Datadog RBAC Report\n\nNo RBAC data found. Ensure the workflow ran list_roles, list_users, or list_restriction_queries.";
      return {
        markdown: md,
        json: { error: "No RBAC data found", status: "failed" },
      };
    }

    const roles = rolesData?.items ?? [];
    const users = usersData?.items ?? [];
    const permissions = permsData?.items ?? [];
    const restrictionQueries = rqData?.items ?? [];
    const fetchedAt = rolesData?.fetchedAt ?? usersData?.fetchedAt ??
      new Date().toISOString();

    // Build permission name lookup
    const permNameMap = new Map<string, PermissionItem>();
    for (const p of permissions) permNameMap.set(p.id, p);

    // Build role lookup
    const roleNameMap = new Map<string, RoleItem>();
    for (const r of roles) roleNameMap.set(r.id, r);

    // ─── Build Markdown ─────────────────────────────────────────────────
    let md = `# 🔐 Datadog RBAC Report\n\n`;
    md += `**Generated:** ${formatDate(fetchedAt)}\n`;
    md += `**Workflow:** ${context.workflowName}\n\n`;

    // ── Overview ────────────────────────────────────────────────────────
    md += `## 📊 Overview\n\n`;
    md += `| Metric | Count |\n|--------|-------|\n`;
    md += `| Roles | ${roles.length} |\n`;
    md += `| Users | ${users.length} |\n`;
    md += `| Permissions (catalog) | ${permissions.length} |\n`;
    md += `| Restriction Queries | ${restrictionQueries.length} |\n\n`;

    // ── Roles & Permissions Matrix ──────────────────────────────────────
    if (roles.length > 0) {
      md += `## 👥 Roles\n\n`;
      md += `| Role | Users | Permissions | Data Restrictions |\n`;
      md += `|------|-------|-------------|-------------------|\n`;

      for (const role of roles) {
        const permCount = role.permissions?.length ?? 0;
        const rqsForRole = restrictionQueries.filter(
          (rq) => rq.roles?.some((r) => r.id === role.id),
        );
        const rqSummary = rqsForRole.length > 0
          ? rqsForRole.map((rq) =>
            `${rq.type}: \`${rq.restriction_query ?? "*"}\``
          ).join(", ")
          : "none";

        md += `| **${role.name}** | ${
          role.user_count ?? "?"
        } | ${permCount} | ${rqSummary} |\n`;
      }
      md += "\n";

      // Permission details per role
      md += `### Permission Details\n\n`;
      for (const role of roles) {
        if (!role.permissions || role.permissions.length === 0) continue;

        md +=
          `<details><summary><b>${role.name}</b> (${role.permissions.length} permissions)</summary>\n\n`;

        // Group by permission group
        const permsByGroup = groupBy(role.permissions, (p) => {
          const catalog = permNameMap.get(p.id);
          return catalog?.group_name ?? "Other";
        });

        for (const [group, perms] of Object.entries(permsByGroup)) {
          md += `**${group}:**\n`;
          for (const p of perms) {
            const catalog = permNameMap.get(p.id);
            md += `- ${catalog?.name ?? p.name ?? p.id}`;
            if (catalog?.display_name) md += ` — ${catalog.display_name}`;
            md += "\n";
          }
          md += "\n";
        }
        md += `</details>\n\n`;
      }
    }

    // ── Restriction Queries ─────────────────────────────────────────────
    if (restrictionQueries.length > 0) {
      md += `## 🔒 Restriction Queries (Data Access Filters)\n\n`;
      md += `These queries control which data subset a role can access.\n\n`;

      const byType = groupBy(restrictionQueries, (rq) => rq.type ?? "unknown");

      for (const [dataType, queries] of Object.entries(byType)) {
        md += `### ${dataType.charAt(0).toUpperCase() + dataType.slice(1)}\n\n`;
        md += `| Query Filter | Roles |\n|-------------|-------|\n`;

        for (const rq of queries) {
          const roleNames = rq.roles?.map((r) => {
            const full = roleNameMap.get(r.id);
            return full?.name ?? r.name ?? r.id;
          }).join(", ") ?? "none";

          md += `| \`${rq.restriction_query ?? "*"}\` | ${roleNames} |\n`;
        }
        md += "\n";
      }
    } else {
      md += `## 🔒 Restriction Queries\n\n`;
      md +=
        `No restriction queries found. All roles with read permissions have **unrestricted access** to all data.\n\n`;
    }

    // ── Users without roles ─────────────────────────────────────────────
    if (users.length > 0) {
      const usersNoRoles = users.filter(
        (u) => !u.roles || u.roles.length === 0,
      );
      const disabledUsers = users.filter((u) => u.disabled === true);
      const activeUsers = users.filter(
        (u) => u.status === "Active" && !u.disabled,
      );

      md += `## 👤 User Summary\n\n`;
      md += `| Status | Count |\n|--------|-------|\n`;
      md += `| Active | ${activeUsers.length} |\n`;
      md += `| Disabled | ${disabledUsers.length} |\n`;
      md += `| No roles assigned | ${usersNoRoles.length} |\n\n`;

      if (usersNoRoles.length > 0) {
        md += `### ⚠️ Users Without Roles\n\n`;
        for (const u of usersNoRoles.slice(0, 20)) {
          md += `- ${u.email ?? u.handle ?? u.id} (status: ${
            u.status ?? "unknown"
          })\n`;
        }
        if (usersNoRoles.length > 20) {
          md += `\n_...and ${usersNoRoles.length - 20} more._\n`;
        }
        md += "\n";
      }
    }

    // ── Security Observations ───────────────────────────────────────────
    md += `## 🛡️ Security Observations\n\n`;

    const observations: string[] = [];

    // Check for overly broad roles
    const broadRoles = roles.filter(
      (r) => (r.permissions?.length ?? 0) > 50,
    );
    if (broadRoles.length > 0) {
      observations.push(
        `⚠️ **Overly broad roles:** ${
          broadRoles.map((r) => r.name).join(", ")
        } have 50+ permissions — consider splitting.`,
      );
    }

    // Check for data types without restriction queries
    const coveredTypes = new Set(restrictionQueries.map((rq) => rq.type));
    const expectedTypes = ["logs", "spans", "events", "rum"];
    const uncoveredTypes = expectedTypes.filter((t) => !coveredTypes.has(t));
    if (uncoveredTypes.length > 0 && restrictionQueries.length > 0) {
      observations.push(
        `⚠️ **No restriction queries for:** ${
          uncoveredTypes.join(", ")
        } — all roles with read permission see all data for these types.`,
      );
    }

    if (restrictionQueries.length === 0 && roles.length > 0) {
      observations.push(
        `⚠️ **No restriction queries configured** — all users with read permissions have unrestricted access to all data types.`,
      );
    }

    // Roles with no users
    const emptyRoles = roles.filter((r) => r.user_count === 0);
    if (emptyRoles.length > 0) {
      observations.push(
        `ℹ️ **Unused roles (0 users):** ${
          emptyRoles.map((r) => r.name).join(", ")
        }`,
      );
    }

    if (observations.length === 0) {
      md += "✅ No immediate security concerns detected.\n\n";
    } else {
      for (const obs of observations) {
        md += `${obs}\n\n`;
      }
    }

    // ── Agent Summary ───────────────────────────────────────────────────
    md += `## 🤖 Agent Summary\n\n`;
    md +=
      `This org has ${roles.length} roles, ${users.length} users, and ${restrictionQueries.length} restriction queries. `;
    if (restrictionQueries.length > 0) {
      md += `Data access is filtered for: ${[...coveredTypes].join(", ")}. `;
      if (uncoveredTypes.length > 0) {
        md += `No restrictions exist for: ${uncoveredTypes.join(", ")}. `;
      }
    } else {
      md +=
        `No data-level restriction queries are configured — all users with read permissions have full access. `;
    }
    md +=
      `Use \`analyze_access\` with a specific user email to trace their full permission chain.\n`;

    // ─── Build JSON ─────────────────────────────────────────────────────
    const json = {
      status: "success",
      fetchedAt,
      summary: {
        roleCount: roles.length,
        userCount: users.length,
        permissionCount: permissions.length,
        restrictionQueryCount: restrictionQueries.length,
        coveredDataTypes: [...coveredTypes],
        uncoveredDataTypes: uncoveredTypes,
      },
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        userCount: r.user_count,
        permissionCount: r.permissions?.length ?? 0,
        dataRestrictions: restrictionQueries
          .filter((rq) => rq.roles?.some((rr) => rr.id === r.id))
          .map((rq) => ({ type: rq.type, query: rq.restriction_query })),
      })),
      restrictionQueries: restrictionQueries.map((rq) => ({
        id: rq.id,
        type: rq.type,
        query: rq.restriction_query,
        roles: rq.roles?.map((r) => ({
          id: r.id,
          name: roleNameMap.get(r.id)?.name ?? r.name,
        })),
      })),
      securityObservations: observations,
      broadRoles: broadRoles.map((r) => r.name),
      emptyRoles: emptyRoles.map((r) => r.name),
      usersWithoutRoles: users
        .filter((u) => !u.roles || u.roles.length === 0)
        .map((u) => u.email ?? u.handle ?? u.id),
    };

    return { markdown: md, json };
  },
};
