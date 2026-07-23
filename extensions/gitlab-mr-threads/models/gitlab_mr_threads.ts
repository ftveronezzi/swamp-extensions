/**
 * GitLab MR Discussion Threads — fetch, reply to, and resolve MR discussion
 * threads via the GitLab REST API. Complements @webframp/gitlab (general MR
 * notes) and @webframp/gitlab-review (diff-based reviews) by exposing the
 * thread/discussion lifecycle: list unresolved threads, reply within a thread,
 * and resolve threads programmatically.
 *
 * @module
 */
import { z } from "npm:zod@4.4.3";

// =============================================================================
// Schemas
// =============================================================================

const GlobalArgsSchema = z.object({
  host: z.string().describe("GitLab hostname (e.g. gitlab.example.com)"),
  token: z.string().meta({ sensitive: true }).describe(
    "GitLab personal access token with api scope",
  ),
});

const NoteSchema = z.object({
  id: z.number(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  resolved: z.boolean(),
  resolvable: z.boolean(),
  system: z.boolean(),
  position: z
    .object({
      filePath: z.string().nullable(),
      oldLine: z.number().nullable(),
      newLine: z.number().nullable(),
    })
    .nullable(),
});

const ThreadSchema = z.object({
  id: z.string(),
  resolved: z.boolean(),
  resolvable: z.boolean(),
  notes: z.array(NoteSchema),
});

const ThreadsOutputSchema = z.object({
  project: z.string(),
  iid: z.number(),
  threads: z.array(ThreadSchema),
  totalCount: z.number(),
  unresolvedCount: z.number(),
  resolvedCount: z.number(),
  fetchedAt: z.string(),
});

const ReplyOutputSchema = z.object({
  project: z.string(),
  iid: z.number(),
  threadId: z.string(),
  noteId: z.number(),
  body: z.string(),
  postedAt: z.string(),
});

const ResolveOutputSchema = z.object({
  project: z.string(),
  iid: z.number(),
  threadId: z.string(),
  resolved: z.boolean(),
  resolvedAt: z.string(),
});

// =============================================================================
// Helpers
// =============================================================================

interface ModelContext {
  globalArgs: { host: string; token: string };
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

function apiUrl(host: string, path: string): string {
  return `https://${host}/api/v4${path}`;
}

function encodeProject(project: string): string {
  return encodeURIComponent(project);
}

function instanceName(prefix: string, project: string, iid: number): string {
  return `${prefix}-${encodeURIComponent(project)}-${iid}`;
}

async function gitlabFetch(
  host: string,
  token: string,
  path: string,
  opts?: RequestInit,
): Promise<Response> {
  const url = apiUrl(host, path);
  const resp = await fetch(url, {
    ...opts,
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
      ...(opts?.headers || {}),
    },
  });
  if (!resp.ok) {
    let body: string;
    try {
      body = await resp.text();
    } catch {
      body = "[unable to read response body]";
    }
    throw new Error(`GitLab API ${resp.status}: ${body}`);
  }
  return resp;
}

// deno-lint-ignore no-explicit-any
function parseNote(note: any): z.infer<typeof NoteSchema> {
  return {
    id: note.id,
    body: note.body ?? "",
    author: note.author?.username ?? "unknown",
    createdAt: note.created_at ?? "",
    resolved: note.resolved ?? false,
    resolvable: note.resolvable ?? false,
    system: note.system ?? false,
    position: note.position
      ? {
        filePath: note.position.new_path ?? note.position.old_path ?? null,
        oldLine: note.position.old_line ?? null,
        newLine: note.position.new_line ?? null,
      }
      : null,
  };
}

// =============================================================================
// Model
// =============================================================================

/** GitLab MR Discussion Threads — list, reply to, and resolve discussion threads on merge requests. */
export const model = {
  type: "@figura/gitlab-mr-threads",
  version: "2026.07.17.2",
  globalArguments: GlobalArgsSchema,
  resources: {
    threads: {
      description: "Discussion threads on an MR",
      schema: ThreadsOutputSchema,
      lifetime: "15m" as const,
      garbageCollection: 10,
    },
    reply: {
      description: "Record of a reply posted to a thread",
      schema: ReplyOutputSchema,
      lifetime: "7d" as const,
      garbageCollection: 20,
    },
    resolve: {
      description: "Record of a thread resolution action",
      schema: ResolveOutputSchema,
      lifetime: "7d" as const,
      garbageCollection: 20,
    },
  },
  methods: {
    list_mr_threads: {
      description:
        "Fetch all discussion threads on a merge request. Returns threads with their notes, " +
        "resolution status, and file position context (for inline comments).",
      arguments: z.object({
        project: z.string().describe("Project path (e.g. mygroup/myproject)"),
        iid: z.number().describe("Merge request IID"),
        filter: z
          .enum(["all", "unresolved", "resolved"])
          .default("all")
          .describe("Filter threads by resolution status"),
      }),
      execute: async (
        args: { project: string; iid: number; filter: string },
        context: ModelContext,
      ) => {
        const { host, token } = context.globalArgs;
        const pid = encodeProject(args.project);

        // Paginate through all discussions
        // deno-lint-ignore no-explicit-any
        const allDiscussions: any[] = [];
        let page = 1;
        const perPage = 100;

        while (true) {
          const resp = await gitlabFetch(
            host,
            token,
            `/projects/${pid}/merge_requests/${args.iid}/discussions?per_page=${perPage}&page=${page}`,
          );
          const discussions = await resp.json();
          if (!Array.isArray(discussions) || discussions.length === 0) break;
          allDiscussions.push(...discussions);

          const nextPage = resp.headers.get("x-next-page");
          if (!nextPage || nextPage === "") break;
          page = parseInt(nextPage, 10);
        }

        // Transform to our schema, filtering non-discussion items
        const threads = allDiscussions
          // deno-lint-ignore no-explicit-any
          .filter((d: any) => {
            // Skip system-only discussions (e.g., "changed the description")
            const notes = d.notes ?? [];
            // deno-lint-ignore no-explicit-any
            const hasHumanNote = notes.some((n: any) => !n.system);
            return hasHumanNote;
          })
          // deno-lint-ignore no-explicit-any
          .map((d: any) => {
            const notes = (d.notes ?? []).map(parseNote);
            // A discussion is resolved if all resolvable notes are resolved
            const resolvableNotes = notes.filter(
              (n: z.infer<typeof NoteSchema>) => n.resolvable,
            );
            const resolved = resolvableNotes.length > 0 &&
              resolvableNotes.every(
                (n: z.infer<typeof NoteSchema>) => n.resolved,
              );
            const resolvable = resolvableNotes.length > 0;
            return {
              id: d.id as string,
              resolved,
              resolvable,
              notes,
            };
          });

        // Apply filter
        const filtered = threads.filter(
          (t: z.infer<typeof ThreadSchema>) => {
            if (args.filter === "unresolved") {
              return t.resolvable && !t.resolved;
            }
            if (args.filter === "resolved") return t.resolved;
            return true;
          },
        );

        const unresolvedCount = threads.filter(
          (t: z.infer<typeof ThreadSchema>) => t.resolvable && !t.resolved,
        ).length;
        const resolvedCount = threads.filter(
          (t: z.infer<typeof ThreadSchema>) => t.resolved,
        ).length;

        const data = {
          project: args.project,
          iid: args.iid,
          threads: filtered,
          totalCount: filtered.length,
          unresolvedCount,
          resolvedCount,
          fetchedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "threads",
          instanceName("threads", args.project, args.iid),
          data,
        );

        context.logger.info("Fetched MR threads", {
          project: args.project,
          iid: args.iid,
          total: filtered.length,
          unresolved: unresolvedCount,
          resolved: resolvedCount,
        });
        return { dataHandles: [handle] };
      },
    },

    reply_to_thread: {
      description:
        "Post a reply to an existing discussion thread on a merge request. " +
        "The reply appears as a new note within the thread.",
      arguments: z.object({
        project: z.string().describe("Project path (e.g. mygroup/myproject)"),
        iid: z.number().describe("Merge request IID"),
        threadId: z.string().describe("Discussion thread ID"),
        body: z.string().describe("Reply body (markdown)"),
      }),
      execute: async (
        args: { project: string; iid: number; threadId: string; body: string },
        context: ModelContext,
      ) => {
        const { host, token } = context.globalArgs;
        const pid = encodeProject(args.project);

        const resp = await gitlabFetch(
          host,
          token,
          `/projects/${pid}/merge_requests/${args.iid}/discussions/${args.threadId}/notes`,
          {
            method: "POST",
            body: JSON.stringify({ body: args.body }),
          },
        );
        const note = await resp.json();

        const data = {
          project: args.project,
          iid: args.iid,
          threadId: args.threadId,
          noteId: (note as Record<string, unknown>).id as number,
          body: args.body,
          postedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "reply",
          `reply-${
            encodeURIComponent(args.project)
          }-${args.iid}-${args.threadId}`,
          data,
        );

        context.logger.info("Posted reply to thread", {
          project: args.project,
          iid: args.iid,
          threadId: args.threadId,
          noteId: data.noteId,
        });
        return { dataHandles: [handle] };
      },
    },

    resolve_thread: {
      description:
        "Resolve or unresolve a discussion thread on a merge request. " +
        "Sets the resolved status of the entire thread.",
      arguments: z.object({
        project: z.string().describe("Project path (e.g. mygroup/myproject)"),
        iid: z.number().describe("Merge request IID"),
        threadId: z.string().describe("Discussion thread ID"),
        resolved: z
          .boolean()
          .default(true)
          .describe("True to resolve, false to unresolve"),
      }),
      execute: async (
        args: {
          project: string;
          iid: number;
          threadId: string;
          resolved: boolean;
        },
        context: ModelContext,
      ) => {
        const { host, token } = context.globalArgs;
        const pid = encodeProject(args.project);

        await gitlabFetch(
          host,
          token,
          `/projects/${pid}/merge_requests/${args.iid}/discussions/${args.threadId}`,
          {
            method: "PUT",
            body: JSON.stringify({ resolved: args.resolved }),
          },
        );

        const data = {
          project: args.project,
          iid: args.iid,
          threadId: args.threadId,
          resolved: args.resolved,
          resolvedAt: new Date().toISOString(),
        };

        const handle = await context.writeResource(
          "resolve",
          `resolve-${
            encodeURIComponent(args.project)
          }-${args.iid}-${args.threadId}`,
          data,
        );

        context.logger.info(
          args.resolved ? "Resolved thread" : "Unresolved thread",
          {
            project: args.project,
            iid: args.iid,
            threadId: args.threadId,
          },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
