/**
 * Morning Redmine Summary Report — Enhanced
 *
 * Produces a daily briefing with:
 * 1. Silver Crew issues grouped by assignee (workload view)
 * 2. Top 5 In Progress Silver Crew issues with deep summary (journals, description)
 * 3. Felipe's assigned issues with full detail and staleness tracking
 * 4. Agent-consumable JSON with raw material for status update drafting and split suggestions
 *
 * @module
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Issue {
  id: number;
  subject: string;
  status: { id: number; name: string };
  priority: { id: number; name: string };
  assignedTo: { id: number; name: string } | null;
  updatedOn: string;
  createdOn: string;
  doneRatio: number;
  description: string;
  customFields: Array<{ id: number; name: string; value: string | string[] }>;
  project: { id: number; name: string };
}

interface IssuesData {
  issues: Issue[];
  totalCount: number;
  fetchedAt: string;
}

interface JournalDetail {
  property: string;
  name: string;
  oldValue: string | null;
  newValue: string | null;
}

interface Journal {
  id: number;
  user: { id: number; name: string };
  notes: string;
  createdOn: string;
  details: JournalDetail[];
}

interface IssueDetail {
  id: number;
  subject: string;
  description: string;
  status: { id: number; name: string };
  priority: { id: number; name: string };
  assignedTo: { id: number; name: string } | null;
  author: { id: number; name: string };
  updatedOn: string;
  createdOn: string;
  doneRatio: number;
  customFields: Array<{ id: number; name: string; value: string | string[] }>;
  journals: Journal[];
  children: Array<{ id: number; tracker: { id: number; name: string }; subject: string }>;
  relations: Array<{ id: number; issueId: number; issueToId: number; relationType: string }>;
  parent: { id: number } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTeamValue(issue: Issue | IssueDetail): string {
  const teamField = issue.customFields?.find((cf) => cf.id === 109);
  if (!teamField) return "";
  return Array.isArray(teamField.value) ? teamField.value[0] || "" : teamField.value;
}

function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86400000);
}

function timeSince(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now.getTime() - then.getTime();

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return days === 1 ? "1 day ago" : `${days} days ago`;
  if (hours > 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return minutes <= 1 ? "just now" : `${minutes} minutes ago`;
}

function statusEmoji(status: string): string {
  switch (status) {
    case "New": return "🆕";
    case "In Progress": return "🔧";
    case "Ready": return "✅";
    case "Design": return "📐";
    case "Re-Work": return "🔄";
    case "Waiting": return "⏳";
    default: return "📋";
  }
}

function stalenessIndicator(daysSinceUpdate: number): string {
  if (daysSinceUpdate > 14) return "🔴";
  if (daysSinceUpdate > 7) return "🟡";
  return "🟢";
}

function formatJournalEntry(j: Journal): string {
  const date = new Date(j.createdOn).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const parts: string[] = [];
  if (j.notes) {
    const truncated = j.notes.length > 200 ? j.notes.slice(0, 200) + "..." : j.notes;
    parts.push(truncated.replace(/\n/g, " "));
  }
  for (const d of j.details) {
    if (d.property === "attr" && d.name === "status_id") {
      parts.push(`status → ${d.newValue || "?"}`);
    } else if (d.property === "attr" && d.name === "assigned_to_id") {
      parts.push(`reassigned`);
    } else if (d.property === "attr" && d.name === "done_ratio") {
      parts.push(`progress ${d.oldValue || 0}% → ${d.newValue || 0}%`);
    }
  }
  if (parts.length === 0) return "";
  return `  - **${date}** (${j.user.name}): ${parts.join("; ")}`;
}

function truncateDescription(desc: string | null | undefined, maxLen = 300): string {
  if (!desc) return "_No description_";
  const cleaned = desc.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "...";
}

// ─── Report ───────────────────────────────────────────────────────────────────

export const report = {
  name: "@local/morning-redmine-summary",
  description: "Daily morning briefing: Silver Crew by assignee, Felipe's issues with journals, agent-consumable JSON",
  scope: "workflow" as const,
  labels: ["daily", "redmine", "summary", "agent-input"],
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
      getContent: (type: string, modelId: string, dataName: string, version?: number) => Promise<Uint8Array | null>;
    };
  }) => {
    const now = new Date();

    // ─── Step 1: Parse list-open-issues ─────────────────────────────────
    const allIssuesStep = context.stepExecutions.find(
      (s) => s.stepName === "list-open-issues" && s.jobName === "fetch-issues"
    );

    let allOpenIssues: Issue[] = [];
    let allIssuesTotal = 0;

    if (allIssuesStep?.status === "succeeded") {
      const handle = allIssuesStep.dataHandles.find((h) => h.specName === "issues");
      if (handle) {
        const raw = await context.dataRepository.getContent(
          allIssuesStep.modelType,
          allIssuesStep.modelId,
          handle.name,
          handle.version,
        );
        if (raw) {
          const data: IssuesData = JSON.parse(new TextDecoder().decode(raw));
          allOpenIssues = data.issues;
          allIssuesTotal = data.totalCount;
        }
      }
    }

    // ─── Step 2: Parse list-inprogress-issues ───────────────────────────
    const inProgressStep = context.stepExecutions.find(
      (s) => s.stepName === "list-inprogress-issues" && s.jobName === "fetch-issues"
    );

    let inProgressIssues: Issue[] = [];

    if (inProgressStep?.status === "succeeded") {
      const handle = inProgressStep.dataHandles.find((h) => h.specName === "issues");
      if (handle) {
        const raw = await context.dataRepository.getContent(
          inProgressStep.modelType,
          inProgressStep.modelId,
          handle.name,
          handle.version,
        );
        if (raw) {
          const data: IssuesData = JSON.parse(new TextDecoder().decode(raw));
          inProgressIssues = data.issues;
        }
      }
    }

    // ─── Step 3: Parse issue detail steps ───────────────────────────────
    const detailSteps = context.stepExecutions.filter(
      (s) => s.jobName === "fetch-details" && s.methodName === "get_issue" && s.status === "succeeded"
    );

    const issueDetails = new Map<number, IssueDetail>();

    for (const step of detailSteps) {
      const handle = step.dataHandles.find((h) => h.specName === "issue_detail");
      if (handle) {
        const raw = await context.dataRepository.getContent(
          step.modelType,
          step.modelId,
          handle.name,
          handle.version,
        );
        if (raw) {
          const detail: IssueDetail = JSON.parse(new TextDecoder().decode(raw));
          issueDetails.set(detail.id, detail);
        }
      }
    }

    // ─── Derive issue sets ──────────────────────────────────────────────
    const silverIssues = allOpenIssues.filter(
      (i) => getTeamValue(i).toLowerCase() === "silver"
    );

    const felipeIssues = allOpenIssues.filter(
      (i) => i.assignedTo?.name?.toLowerCase().includes("veronezzi")
    );

    // Top 5 In Progress Silver: filter Silver from inProgressIssues (already sorted by updatedOn desc)
    const silverInProgress = inProgressIssues.filter(
      (i) => getTeamValue(i).toLowerCase() === "silver"
    );
    const top5SilverInProgress = silverInProgress.slice(0, 5);

    // ─── Build Markdown Report ──────────────────────────────────────────
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let md = `# 🌅 Morning Redmine Summary — ${dateStr}\n\n`;

    // ── Section: Felipe's Issues ────────────────────────────────────────
    md += `## 👤 Felipe's Issues (${felipeIssues.length})\n\n`;

    if (felipeIssues.length === 0) {
      md += "_No issues currently assigned._\n\n";
    } else {
      for (const issue of felipeIssues) {
        const daysOpen = daysBetween(issue.createdOn, now);
        const daysSinceUpdate = daysBetween(issue.updatedOn, now);
        const staleness = stalenessIndicator(daysSinceUpdate);
        const overdue = daysOpen > 7 ? " ⚠️ OVERDUE" : "";
        const detail = issueDetails.get(issue.id);

        md += `### ${staleness} #${issue.id} — ${issue.subject}${overdue}\n\n`;
        md += `| Status | Days Open | Last Update | Progress |\n`;
        md += `|--------|-----------|-------------|----------|\n`;
        md += `| ${statusEmoji(issue.status.name)} ${issue.status.name} | ${daysOpen}d | ${timeSince(issue.updatedOn)} | ${issue.doneRatio}% |\n\n`;

        if (detail) {
          // Description
          md += `**Description:**\n${truncateDescription(detail.description)}\n\n`;

          // Journal history
          if (detail.journals.length > 0) {
            md += `**Journal History** (${detail.journals.length} entries):\n`;
            // Show all journals, most recent first
            const sortedJournals = [...detail.journals].sort(
              (a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime()
            );
            for (const j of sortedJournals) {
              const entry = formatJournalEntry(j);
              if (entry) md += entry + "\n";
            }
            md += "\n";
          }
        } else {
          md += "_Detail not available (issue may not be In Progress)_\n\n";
        }
      }

      md += "_Staleness: 🟢 <7d, 🟡 7-14d, 🔴 >14d | Task standard: complete within 1 week_\n\n";
    }

    // ── Section: Silver Crew ────────────────────────────────────────────
    md += `## 🥈 Silver Crew (${silverIssues.length} open issues)\n\n`;

    if (silverIssues.length === 0) {
      md += "_No open Silver Crew issues found._\n\n";
    } else {
      // Group by assignee
      const byAssignee: Record<string, Issue[]> = {};
      for (const issue of silverIssues) {
        const assignee = issue.assignedTo?.name || "Unassigned";
        if (!byAssignee[assignee]) byAssignee[assignee] = [];
        byAssignee[assignee].push(issue);
      }

      // Sort assignees by number of issues (desc)
      const sortedAssignees = Object.entries(byAssignee).sort(
        (a, b) => b[1].length - a[1].length
      );

      for (const [assignee, issues] of sortedAssignees) {
        const inProg = issues.filter((i) => i.status.name === "In Progress").length;
        md += `### ${assignee} (${issues.length} issues, ${inProg} in progress)\n\n`;
        md += "| # | Subject | Status | Last Update |\n";
        md += "|---|---------|--------|-------------|\n";
        for (const i of issues) {
          md += `| ${i.id} | ${i.subject} | ${statusEmoji(i.status.name)} ${i.status.name} | ${timeSince(i.updatedOn)} |\n`;
        }
        md += "\n";
      }

      // Top 5 In Progress deep summary
      if (top5SilverInProgress.length > 0) {
        md += `### 🔥 Top ${top5SilverInProgress.length} Active In Progress\n\n`;

        for (const issue of top5SilverInProgress) {
          const detail = issueDetails.get(issue.id);
          const daysOpen = daysBetween(issue.createdOn, now);
          const assignee = issue.assignedTo?.name || "Unassigned";

          md += `#### #${issue.id} — ${issue.subject}\n`;
          md += `> Assignee: ${assignee} | Days open: ${daysOpen} | Updated: ${timeSince(issue.updatedOn)}\n\n`;

          if (detail) {
            md += `**Description:** ${truncateDescription(detail.description, 200)}\n\n`;

            // Last 3 journal entries
            if (detail.journals.length > 0) {
              const recent = [...detail.journals]
                .sort((a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime())
                .slice(0, 3);
              md += `**Recent activity:**\n`;
              for (const j of recent) {
                const entry = formatJournalEntry(j);
                if (entry) md += entry + "\n";
              }
              md += "\n";

              // Who last updated
              const lastJournal = recent[0];
              md += `_Last update by ${lastJournal.user.name} on ${new Date(lastJournal.createdOn).toLocaleDateString("en-US", { month: "short", day: "numeric" })}_\n\n`;
            }
          }
        }
      }
    }

    // ── Section: Quick Stats ────────────────────────────────────────────
    md += `## 📊 Quick Stats\n\n`;
    md += `- **Total open issues (project):** ${allIssuesTotal}\n`;
    md += `- **Silver Crew issues:** ${silverIssues.length}\n`;
    md += `- **Assigned to Felipe:** ${felipeIssues.length}\n`;
    md += `- **In Progress (all):** ${inProgressIssues.length}\n`;
    md += `- **Issues with detail fetched:** ${issueDetails.size}\n`;

    if (silverIssues.length > 0) {
      const inProgress = silverIssues.filter((i) => i.status.name === "In Progress").length;
      const ready = silverIssues.filter((i) => i.status.name === "Ready").length;
      const newCount = silverIssues.filter((i) => i.status.name === "New").length;
      md += `- **Silver breakdown:** ${inProgress} In Progress, ${ready} Ready, ${newCount} New\n`;
    }

    // ─── Build JSON Output ──────────────────────────────────────────────

    // Felipe's issues with full detail for agent consumption
    const felipeJson = felipeIssues.map((issue) => {
      const detail = issueDetails.get(issue.id);
      const daysOpen = daysBetween(issue.createdOn, now);
      const daysSinceUpdate = daysBetween(issue.updatedOn, now);

      return {
        id: issue.id,
        subject: issue.subject,
        description: detail?.description || issue.description || "",
        status: issue.status.name,
        daysOpen,
        daysSinceUpdate,
        needsSplit: daysOpen > 7,
        journals: detail?.journals
          .sort((a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime())
          .map((j) => ({
            date: j.createdOn,
            author: j.user.name,
            notes: j.notes || "",
            changes: j.details.map((d) => ({
              property: d.property,
              field: d.name,
              from: d.oldValue,
              to: d.newValue,
            })),
          })) || [],
        children: detail?.children || [],
        parent: detail?.parent || null,
        doneRatio: issue.doneRatio,
      };
    });

    // Top 5 Silver In Progress with detail for agent consumption
    const crewTopJson = top5SilverInProgress.map((issue) => {
      const detail = issueDetails.get(issue.id);
      const daysOpen = daysBetween(issue.createdOn, now);

      const recentJournals = detail?.journals
        .sort((a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime())
        .slice(0, 3)
        .map((j) => ({
          date: j.createdOn,
          author: j.user.name,
          notes: j.notes || "",
          changes: j.details.map((d) => ({
            property: d.property,
            field: d.name,
            from: d.oldValue,
            to: d.newValue,
          })),
        })) || [];

      return {
        id: issue.id,
        subject: issue.subject,
        description: detail?.description || issue.description || "",
        assignee: issue.assignedTo?.name || null,
        status: issue.status.name,
        daysOpen,
        daysSinceUpdate: daysBetween(issue.updatedOn, now),
        recentJournals,
      };
    });

    const json = {
      date: now.toISOString(),
      assignedToFelipe: {
        total: felipeIssues.length,
        issues: felipeJson,
      },
      crewTopActive: {
        total: top5SilverInProgress.length,
        issues: crewTopJson,
      },
      silverCrew: {
        total: silverIssues.length,
        byStatus: {
          inProgress: silverIssues.filter((i) => i.status.name === "In Progress").length,
          ready: silverIssues.filter((i) => i.status.name === "Ready").length,
          new: silverIssues.filter((i) => i.status.name === "New").length,
          other: silverIssues.filter((i) =>
            !["In Progress", "Ready", "New"].includes(i.status.name)
          ).length,
        },
        byAssignee: Object.fromEntries(
          Object.entries(
            silverIssues.reduce((acc, i) => {
              const name = i.assignedTo?.name || "Unassigned";
              if (!acc[name]) acc[name] = 0;
              acc[name]++;
              return acc;
            }, {} as Record<string, number>)
          ).sort((a, b) => b[1] - a[1])
        ),
      },
      projectTotal: allIssuesTotal,
    };

    return { markdown: md, json };
  },
};
