/**
 * Terraform Scanner — LLM-powered code quality analysis for Terraform repos.
 *
 * Scans a repository (local path or GitLab remote) for:
 * - Naming convention consistency and violations
 * - Internal module usage vs raw resources
 * - Code organization (file structure, separation of concerns)
 * - Terraform best practices (provider pinning, variable validation,
 *   state isolation, tagging, for_each vs count, hardcoded values, etc.)
 *
 * Uses LiteLLM-compatible API for analysis.
 *
 * @module
 */
import { z } from "npm:zod@4.4.3";

// =============================================================================
// Schemas
// =============================================================================

const GlobalArgsSchema = z.object({
  llmBaseUrl: z.string().describe(
    "LiteLLM-compatible API base URL (e.g. http://localhost:4000/v1)",
  ),
  llmApiKey: z.string().meta({ sensitive: true }).describe("LLM API key"),
  llmModel: z.string().default("claude-haiku-3-5").describe(
    "Model name for LLM calls (default: claude-haiku-3-5)",
  ),
  gitlabHost: z.string().optional().describe(
    "GitLab hostname for remote repos (e.g. gitlab.example.com)",
  ),
  gitlabToken: z.string().optional().meta({ sensitive: true }).describe(
    "GitLab personal access token for remote repo access",
  ),
});

const FindingSchema = z.object({
  category: z.enum([
    "naming_convention",
    "module_usage",
    "code_organization",
    "provider_pinning",
    "variable_validation",
    "state_management",
    "resource_tagging",
    "hardcoded_values",
    "deprecated_usage",
    "for_each_vs_count",
    "security",
    "general_best_practice",
  ]),
  severity: z.enum(["critical", "warning", "info"]),
  file: z.string(),
  line: z.number().nullable(),
  title: z.string(),
  description: z.string(),
  suggestion: z.string(),
  pattern_context: z.string().nullable().describe(
    "What pattern was expected based on the rest of the codebase",
  ),
});

const PatternSummarySchema = z.object({
  naming: z.object({
    resource_pattern: z.string().describe("Detected naming pattern for resources"),
    variable_pattern: z.string().describe("Detected naming pattern for variables"),
    module_pattern: z.string().describe("Detected naming pattern for modules"),
    violations: z.number(),
  }),
  modules: z.object({
    internal_modules_used: z.array(z.string()),
    raw_resources_that_should_be_modules: z.array(z.string()),
    violations: z.number(),
  }),
  organization: z.object({
    file_structure: z.string().describe("Detected file organization pattern"),
    concerns: z.array(z.string()),
    violations: z.number(),
  }),
});

const ScanResultsSchema = z.object({
  repo: z.string(),
  ref: z.string().nullable(),
  scannedAt: z.string(),
  totalFiles: z.number(),
  totalFindings: z.number(),
  findingsBySeverity: z.object({
    critical: z.number(),
    warning: z.number(),
    info: z.number(),
  }),
  findingsByCategory: z.record(z.string(), z.number()),
  patterns: PatternSummarySchema,
  findings: z.array(FindingSchema),
  summary: z.string().describe("Human-readable executive summary"),
  agentSummary: z.string().describe(
    "Agent-consumable summary with actionable next steps",
  ),
});

// =============================================================================
// Types
// =============================================================================

interface ModelContext {
  globalArgs: {
    llmBaseUrl: string;
    llmApiKey: string;
    llmModel: string;
    gitlabHost?: string;
    gitlabToken?: string;
  };
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

interface RepoFile {
  path: string;
  content: string;
}

// =============================================================================
// Helpers — File Collection
// =============================================================================

const SKIP_DIRS = new Set([
  ".terraform",
  ".terragrunt-cache",
  "node_modules",
  ".git",
  "vendor",
  ".swamp",
]);

async function collectLocalFiles(basePath: string): Promise<RepoFile[]> {
  const files: RepoFile[] = [];

  async function walk(dir: string, relative: string) {
    for await (const entry of Deno.readDir(dir)) {
      const fullPath = `${dir}/${entry.name}`;
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath, relPath);
      } else if (entry.isFile && entry.name.endsWith(".tf")) {
        try {
          const content = await Deno.readTextFile(fullPath);
          files.push({ path: relPath, content });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  // Check if there's a /terraform subdirectory
  let scanDir = basePath;
  try {
    const stat = await Deno.stat(`${basePath}/terraform`);
    if (stat.isDirectory) {
      scanDir = `${basePath}/terraform`;
    }
  } catch {
    // no /terraform dir, scan from root
  }

  await walk(scanDir, "");
  return files;
}

async function collectGitLabFiles(
  host: string,
  token: string,
  project: string,
  ref: string,
): Promise<RepoFile[]> {
  const files: RepoFile[] = [];
  const encodedProject = encodeURIComponent(project);

  // Get repository tree recursively
  let page = 1;
  const allPaths: string[] = [];

  while (true) {
    const url =
      `https://${host}/api/v4/projects/${encodedProject}/repository/tree?ref=${ref}&recursive=true&per_page=100&page=${page}`;
    const resp = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (!resp.ok) {
      throw new Error(
        `GitLab tree API error ${resp.status}: ${await resp.text()}`,
      );
    }
    const items = (await resp.json()) as Array<{
      name: string;
      path: string;
      type: string;
    }>;
    if (items.length === 0) break;

    for (const item of items) {
      if (item.type !== "blob") continue;
      if (!item.name.endsWith(".tf")) continue;

      // Skip excluded directories
      const parts = item.path.split("/");
      const shouldSkip = parts.some((p) => SKIP_DIRS.has(p));
      if (shouldSkip) continue;

      allPaths.push(item.path);
    }

    const nextPage = resp.headers.get("x-next-page");
    if (!nextPage || nextPage === "") break;
    page = parseInt(nextPage, 10);
  }

  // Fetch file contents (batch, max 50 concurrent)
  const batchSize = 10;
  for (let i = 0; i < allPaths.length; i += batchSize) {
    const batch = allPaths.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        const encodedPath = encodeURIComponent(filePath);
        const url =
          `https://${host}/api/v4/projects/${encodedProject}/repository/files/${encodedPath}/raw?ref=${ref}`;
        const resp = await fetch(url, {
          headers: { "PRIVATE-TOKEN": token },
        });
        if (!resp.ok) return null;
        const content = await resp.text();
        return { path: filePath, content };
      }),
    );
    for (const r of results) {
      if (r) files.push(r);
    }
  }

  return files;
}

// =============================================================================
// Helpers — LLM
// =============================================================================

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LLMMessage[],
  maxTokens = 4096,
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

// =============================================================================
// Analysis Prompts
// =============================================================================

const SYSTEM_PROMPT = `You are a senior Terraform/infrastructure engineer performing a thorough code quality review. 
You analyze Terraform codebases for:
1. **Naming conventions** — Detect the dominant patterns in the codebase and flag inconsistencies
2. **Module usage** — Identify where raw resources are used instead of available internal modules
3. **Code organization** — File structure, separation of concerns
4. **Best practices** — Provider pinning, variable validation, state management, tagging, for_each vs count, hardcoded values, deprecated usage, security

You MUST respond with valid JSON only. No markdown fences, no explanation outside the JSON.`;

function buildAnalysisPrompt(files: RepoFile[], chunkIndex: number, totalChunks: number): string {
  const fileList = files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}\n--- END FILE ---`)
    .join("\n\n");

  return `Analyze these Terraform files (chunk ${chunkIndex + 1}/${totalChunks}). 

Return a JSON object with this exact structure:
{
  "findings": [
    {
      "category": "<one of: naming_convention, module_usage, code_organization, provider_pinning, variable_validation, state_management, resource_tagging, hardcoded_values, deprecated_usage, for_each_vs_count, security, general_best_practice>",
      "severity": "<critical|warning|info>",
      "file": "<file path>",
      "line": <line number or null>,
      "title": "<short title>",
      "description": "<what's wrong>",
      "suggestion": "<how to fix it>",
      "pattern_context": "<what pattern the rest of the codebase follows, or null>"
    }
  ],
  "detected_patterns": {
    "resource_naming": "<describe the naming pattern you see for resources>",
    "variable_naming": "<describe the naming pattern for variables>",
    "module_naming": "<describe the naming pattern for modules>",
    "file_structure": "<describe the file organization pattern>",
    "internal_modules": ["<list of module sources that appear to be internal/shared>"],
    "raw_resources_needing_modules": ["<resources that should use an internal module instead>"]
  }
}

Focus on actionable findings. Severity guide:
- critical: Security issues, missing state locking, no provider constraints
- warning: Naming inconsistencies, missing validations, hardcoded values, raw resources where modules exist
- info: Style improvements, organizational suggestions

FILES:
${fileList}`;
}

function buildSummaryPrompt(
  allFindings: unknown[],
  patterns: Record<string, unknown>,
  repo: string,
  totalFiles: number,
): string {
  return `Based on the analysis of ${totalFiles} Terraform files in "${repo}", produce a final summary.

FINDINGS (${allFindings.length} total):
${JSON.stringify(allFindings, null, 2)}

DETECTED PATTERNS:
${JSON.stringify(patterns, null, 2)}

Return a JSON object with:
{
  "summary": "<3-5 sentence executive summary for humans>",
  "agentSummary": "<structured summary for an AI agent to act on, including top 3 priority fixes with file paths and what to change>",
  "patterns": {
    "naming": {
      "resource_pattern": "<detected resource naming convention>",
      "variable_pattern": "<detected variable naming convention>", 
      "module_pattern": "<detected module naming convention>",
      "violations": <count of naming violations>
    },
    "modules": {
      "internal_modules_used": ["<list of internal module sources found>"],
      "raw_resources_that_should_be_modules": ["<specific resources that should use internal modules>"],
      "violations": <count>
    },
    "organization": {
      "file_structure": "<describe the expected file layout>",
      "concerns": ["<list of organization concerns>"],
      "violations": <count>
    }
  }
}`;
}

// =============================================================================
// Model
// =============================================================================

export const model = {
  type: "@local/terraform-scanner",
  version: "2026.07.21.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    scan_results: {
      description:
        "Full scan results with findings, patterns, and summaries",
      schema: ScanResultsSchema,
      lifetime: "30d" as const,
      garbageCollection: 10,
    },
  },
  methods: {
    scan: {
      description:
        "Scan a Terraform repository for code quality issues. " +
        "Provide either a local path OR a GitLab project path. " +
        "Analyzes naming conventions, module usage, code organization, " +
        "and Terraform best practices using LLM-powered analysis.",
      arguments: z.object({
        localPath: z
          .string()
          .optional()
          .describe("Local filesystem path to the repo root"),
        gitlabProject: z
          .string()
          .optional()
          .describe(
            "GitLab project path for remote scan (e.g. o11n/terraform-infra)",
          ),
        ref: z
          .string()
          .default("main")
          .describe("Git ref to scan (branch/tag, default: main)"),
      }),
      execute: async (
        args: { localPath?: string; gitlabProject?: string; ref: string },
        context: ModelContext,
      ) => {
        const { llmBaseUrl, llmApiKey, llmModel, gitlabHost, gitlabToken } =
          context.globalArgs;

        // Normalize empty strings to undefined
        const localPath = args.localPath?.trim() || undefined;
        const gitlabProject = args.gitlabProject?.trim() || undefined;

        // Validate inputs
        if (!localPath && !gitlabProject) {
          throw new Error(
            "Must provide either localPath or gitlabProject",
          );
        }

        const repoName = localPath || gitlabProject || "unknown";
        context.logger.info("Starting Terraform scan", {
          repo: repoName,
          ref: args.ref,
        });

        // ─── Collect files ────────────────────────────────────────────────
        let files: RepoFile[];

        if (localPath) {
          files = await collectLocalFiles(localPath);
        } else {
          if (!gitlabHost || !gitlabToken) {
            throw new Error(
              "gitlabHost and gitlabToken must be configured for remote scans",
            );
          }
          files = await collectGitLabFiles(
            gitlabHost,
            gitlabToken,
            gitlabProject!,
            args.ref,
          );
        }

        if (files.length === 0) {
          throw new Error(
            `No .tf files found in ${repoName}. Check the path or ref.`,
          );
        }

        context.logger.info("Collected Terraform files", {
          count: files.length,
        });

        // ─── Chunk files for LLM analysis ─────────────────────────────────
        // ~4000 chars per file avg, send ~15 files per chunk to stay under context
        const CHUNK_SIZE = 15;
        const chunks: RepoFile[][] = [];
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
          chunks.push(files.slice(i, i + CHUNK_SIZE));
        }

        context.logger.info("Analyzing in chunks", {
          chunks: chunks.length,
          filesPerChunk: CHUNK_SIZE,
        });

        // ─── Run LLM analysis per chunk ───────────────────────────────────
        // deno-lint-ignore no-explicit-any
        const allFindings: any[] = [];
        // deno-lint-ignore no-explicit-any
        const allPatterns: any[] = [];

        for (let i = 0; i < chunks.length; i++) {
          context.logger.info(`Analyzing chunk ${i + 1}/${chunks.length}`);

          const prompt = buildAnalysisPrompt(chunks[i], i, chunks.length);
          const response = await callLLM(
            llmBaseUrl,
            llmApiKey,
            llmModel,
            [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            8192,
          );

          try {
            // Try to extract JSON from response (handle potential markdown fences)
            let jsonStr = response.trim();
            if (jsonStr.startsWith("```")) {
              jsonStr = jsonStr
                .replace(/^```(?:json)?\n?/, "")
                .replace(/\n?```$/, "");
            }
            const parsed = JSON.parse(jsonStr);
            if (parsed.findings) allFindings.push(...parsed.findings);
            if (parsed.detected_patterns) allPatterns.push(parsed.detected_patterns);
          } catch (e) {
            context.logger.warning(
              `Failed to parse LLM response for chunk ${i + 1}: ${e}`,
            );
          }
        }

        context.logger.info("Analysis complete", {
          totalFindings: allFindings.length,
        });

        // ─── Generate summary ─────────────────────────────────────────────
        const mergedPatterns = allPatterns.length > 0 ? allPatterns[0] : {};
        const summaryPrompt = buildSummaryPrompt(
          allFindings,
          mergedPatterns,
          repoName,
          files.length,
        );

        const summaryResponse = await callLLM(
          llmBaseUrl,
          llmApiKey,
          llmModel,
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: summaryPrompt },
          ],
          4096,
        );

        let summary = "";
        let agentSummary = "";
        // deno-lint-ignore no-explicit-any
        let patterns: any = {
          naming: {
            resource_pattern: "unknown",
            variable_pattern: "unknown",
            module_pattern: "unknown",
            violations: 0,
          },
          modules: {
            internal_modules_used: [],
            raw_resources_that_should_be_modules: [],
            violations: 0,
          },
          organization: {
            file_structure: "unknown",
            concerns: [],
            violations: 0,
          },
        };

        try {
          let jsonStr = summaryResponse.trim();
          if (jsonStr.startsWith("```")) {
            jsonStr = jsonStr
              .replace(/^```(?:json)?\n?/, "")
              .replace(/\n?```$/, "");
          }
          const parsed = JSON.parse(jsonStr);
          summary = parsed.summary || "";
          agentSummary = parsed.agentSummary || "";
          if (parsed.patterns) patterns = parsed.patterns;
        } catch (e) {
          context.logger.warning(`Failed to parse summary response: ${e}`);
          summary = `Scan completed with ${allFindings.length} findings across ${files.length} files.`;
          agentSummary = summary;
        }

        // ─── Build final result ───────────────────────────────────────────
        const findingsBySeverity = { critical: 0, warning: 0, info: 0 };
        const findingsByCategory: Record<string, number> = {};

        for (const f of allFindings) {
          const sev = f.severity as "critical" | "warning" | "info";
          if (findingsBySeverity[sev] !== undefined) {
            findingsBySeverity[sev]++;
          }
          const cat = f.category as string;
          findingsByCategory[cat] = (findingsByCategory[cat] || 0) + 1;
        }

        const result = {
          repo: repoName,
          ref: gitlabProject ? args.ref : null,
          scannedAt: new Date().toISOString(),
          totalFiles: files.length,
          totalFindings: allFindings.length,
          findingsBySeverity,
          findingsByCategory,
          patterns,
          findings: allFindings,
          summary,
          agentSummary,
        };

        // Write resource
        const instanceName = repoName
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .replace(/-+/g, "-")
          .toLowerCase();

        const handle = await context.writeResource(
          "scan_results",
          `scan-${instanceName}`,
          result as unknown as Record<string, unknown>,
        );

        context.logger.info("Scan results written", {
          repo: repoName,
          findings: allFindings.length,
          critical: findingsBySeverity.critical,
          warning: findingsBySeverity.warning,
          info: findingsBySeverity.info,
        });

        return { dataHandles: [handle] };
      },
    },
  },
};
