/**
 * Terraform Scan Report — Human + Agent readable output.
 *
 * Produces:
 * - Markdown: Executive summary, findings by severity, pattern analysis, file-level details
 * - JSON: Structured data for agent consumption and automated follow-up
 *
 * @module
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Finding {
  category: string;
  severity: string;
  file: string;
  line: number | null;
  title: string;
  description: string;
  suggestion: string;
  pattern_context: string | null;
}

interface PatternSummary {
  naming: {
    resource_pattern: string;
    variable_pattern: string;
    module_pattern: string;
    violations: number;
  };
  modules: {
    internal_modules_used: string[];
    raw_resources_that_should_be_modules: string[];
    violations: number;
  };
  organization: {
    file_structure: string;
    concerns: string[];
    violations: number;
  };
}

interface ScanResults {
  repo: string;
  ref: string | null;
  scannedAt: string;
  totalFiles: number;
  totalFindings: number;
  findingsBySeverity: { critical: number; warning: number; info: number };
  findingsByCategory: Record<string, number>;
  patterns: PatternSummary;
  findings: Finding[];
  summary: string;
  agentSummary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _severityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "warning":
      return "🟡";
    case "info":
      return "🔵";
    default:
      return "⚪";
  }
}

function categoryLabel(category: string): string {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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

// ─── Report ───────────────────────────────────────────────────────────────────

export const report = {
  name: "@figura/terraform-scan-report",
  description:
    "Terraform scan results formatted for human reading and agent consumption",
  scope: "workflow" as const,
  labels: ["terraform", "code-quality", "scan", "report"],
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
    // Find the scan step
    const scanStep = context.stepExecutions.find(
      (s) =>
        s.methodName === "scan" &&
        s.status === "succeeded" &&
        s.dataHandles.some((h) => h.specName === "scan_results"),
    );

    if (!scanStep) {
      const md =
        "# ❌ Terraform Scan Report\n\nNo successful scan results found.";
      return {
        markdown: md,
        json: { error: "No scan results found", status: "failed" },
      };
    }

    const handle = scanStep.dataHandles.find(
      (h) => h.specName === "scan_results",
    )!;
    const raw = await context.dataRepository.getContent(
      scanStep.modelType,
      scanStep.modelId,
      handle.name,
      handle.version,
    );

    if (!raw) {
      const md = "# ❌ Terraform Scan Report\n\nFailed to read scan data.";
      return {
        markdown: md,
        json: { error: "Failed to read scan data", status: "failed" },
      };
    }

    const results: ScanResults = JSON.parse(new TextDecoder().decode(raw));

    // ─── Build Markdown ─────────────────────────────────────────────────
    let md = `# 🔍 Terraform Scan Report\n\n`;
    md += `**Repo:** \`${results.repo}\``;
    if (results.ref) md += ` (ref: \`${results.ref}\`)`;
    md += `\n**Scanned:** ${formatDate(results.scannedAt)}\n`;
    md += `**Files analyzed:** ${results.totalFiles}\n\n`;

    // ── Executive Summary ───────────────────────────────────────────────
    md += `## 📋 Summary\n\n${results.summary}\n\n`;

    // ── Severity Overview ───────────────────────────────────────────────
    md += `## 📊 Findings Overview\n\n`;
    md += `| Severity | Count |\n|----------|-------|\n`;
    md += `| 🔴 Critical | ${results.findingsBySeverity.critical} |\n`;
    md += `| 🟡 Warning | ${results.findingsBySeverity.warning} |\n`;
    md += `| 🔵 Info | ${results.findingsBySeverity.info} |\n`;
    md += `| **Total** | **${results.totalFindings}** |\n\n`;

    // ── By Category ─────────────────────────────────────────────────────
    if (Object.keys(results.findingsByCategory).length > 0) {
      md += `### By Category\n\n`;
      md += `| Category | Count |\n|----------|-------|\n`;
      const sorted = Object.entries(results.findingsByCategory).sort(
        (a, b) => b[1] - a[1],
      );
      for (const [cat, count] of sorted) {
        md += `| ${categoryLabel(cat)} | ${count} |\n`;
      }
      md += "\n";
    }

    // ── Detected Patterns ───────────────────────────────────────────────
    md += `## 🧬 Detected Patterns\n\n`;

    md += `### Naming Conventions\n`;
    md += `- **Resources:** ${results.patterns.naming.resource_pattern}\n`;
    md += `- **Variables:** ${results.patterns.naming.variable_pattern}\n`;
    md += `- **Modules:** ${results.patterns.naming.module_pattern}\n`;
    md += `- Violations: ${results.patterns.naming.violations}\n\n`;

    md += `### Module Usage\n`;
    if (results.patterns.modules.internal_modules_used.length > 0) {
      md += `- **Internal modules found:** ${
        results.patterns.modules.internal_modules_used.join(", ")
      }\n`;
    } else {
      md += `- No internal modules detected\n`;
    }
    if (
      results.patterns.modules.raw_resources_that_should_be_modules.length > 0
    ) {
      md += `- **Should use modules instead:** ${
        results.patterns.modules.raw_resources_that_should_be_modules.join(", ")
      }\n`;
    }
    md += `- Violations: ${results.patterns.modules.violations}\n\n`;

    md += `### Code Organization\n`;
    md += `- **Structure:** ${results.patterns.organization.file_structure}\n`;
    if (results.patterns.organization.concerns.length > 0) {
      md += `- **Concerns:**\n`;
      for (const c of results.patterns.organization.concerns) {
        md += `  - ${c}\n`;
      }
    }
    md += `- Violations: ${results.patterns.organization.violations}\n\n`;

    // ── Critical & Warning Findings ─────────────────────────────────────
    const criticals = results.findings.filter(
      (f) => f.severity === "critical",
    );
    const warnings = results.findings.filter((f) => f.severity === "warning");
    const infos = results.findings.filter((f) => f.severity === "info");

    if (criticals.length > 0) {
      md += `## 🔴 Critical Findings\n\n`;
      for (const f of criticals) {
        md += `### ${f.title}\n`;
        md += `**File:** \`${f.file}\`${
          f.line ? ` (line ${f.line})` : ""
        } | **Category:** ${categoryLabel(f.category)}\n\n`;
        md += `${f.description}\n\n`;
        md += `**Suggestion:** ${f.suggestion}\n`;
        if (f.pattern_context) {
          md += `\n_Pattern context: ${f.pattern_context}_\n`;
        }
        md += "\n---\n\n";
      }
    }

    if (warnings.length > 0) {
      md += `## 🟡 Warnings\n\n`;
      md += `| File | Title | Category | Suggestion |\n`;
      md += `|------|-------|----------|------------|\n`;
      for (const f of warnings) {
        md += `| \`${f.file}\`${f.line ? `:${f.line}` : ""} | ${f.title} | ${
          categoryLabel(f.category)
        } | ${f.suggestion.slice(0, 100)}${
          f.suggestion.length > 100 ? "..." : ""
        } |\n`;
      }
      md += "\n";
    }

    if (infos.length > 0) {
      md += `## 🔵 Info\n\n`;
      md += `| File | Title | Category |\n`;
      md += `|------|-------|----------|\n`;
      for (const f of infos.slice(0, 20)) {
        md += `| \`${f.file}\`${f.line ? `:${f.line}` : ""} | ${f.title} | ${
          categoryLabel(f.category)
        } |\n`;
      }
      if (infos.length > 20) {
        md += `\n_...and ${infos.length - 20} more info-level findings._\n`;
      }
      md += "\n";
    }

    // ── Agent Instructions ──────────────────────────────────────────────
    md += `## 🤖 Agent Summary\n\n${results.agentSummary}\n`;

    // ─── Build JSON ─────────────────────────────────────────────────────
    const json = {
      status: "success",
      repo: results.repo,
      ref: results.ref,
      scannedAt: results.scannedAt,
      totalFiles: results.totalFiles,
      totalFindings: results.totalFindings,
      severity: results.findingsBySeverity,
      categories: results.findingsByCategory,
      patterns: results.patterns,
      summary: results.summary,
      agentSummary: results.agentSummary,
      criticalFindings: criticals,
      warningFindings: warnings,
      infoFindings: infos,
      topPriorityFixes: criticals
        .concat(warnings)
        .slice(0, 5)
        .map((f) => ({
          file: f.file,
          line: f.line,
          title: f.title,
          category: f.category,
          severity: f.severity,
          suggestion: f.suggestion,
        })),
    };

    return { markdown: md, json };
  },
};
