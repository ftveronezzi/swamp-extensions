# @figura/gitlab-mr-threads

Fetch, reply to, and resolve merge request discussion threads via the GitLab REST API.

Complements [@webframp/gitlab](https://swamp.dev/extensions/@webframp/gitlab) (general MR notes) and [@webframp/gitlab-review](https://swamp.dev/extensions/@webframp/gitlab-review) (diff-based reviews) by exposing the full thread/discussion lifecycle.

## Features

- List all discussion threads on an MR (with filtering by resolution status)
- Reply within an existing thread
- Resolve or unresolve threads programmatically
- Includes file position context for inline/diff comments

## Authentication

Requires a GitLab personal access token with `api` scope, stored in a swamp vault.

## Usage Example

```typescript
import { model } from "@figura/gitlab-mr-threads";

// List all unresolved threads on MR !42
const threads = await model.methods.list_mr_threads.execute(
  { project: "mygroup/myproject", iid: 42, filter: "unresolved" },
  context,
);

// Reply to a specific thread
const reply = await model.methods.reply_to_thread.execute(
  {
    project: "mygroup/myproject",
    iid: 42,
    threadId: "abc123def456",
    body: "Fixed in the latest commit, please re-check.",
  },
  context,
);

// Resolve a thread
const resolved = await model.methods.resolve_thread.execute(
  {
    project: "mygroup/myproject",
    iid: 42,
    threadId: "abc123def456",
    resolved: true,
  },
  context,
);
```

## Methods

| Method | Description |
|--------|-------------|
| `list_mr_threads` | Fetch all discussion threads on an MR with resolution status and file position context |
| `reply_to_thread` | Post a reply to an existing discussion thread |
| `resolve_thread` | Resolve or unresolve a discussion thread |

## License

MIT — see [LICENSE](../../LICENSE) in the repository root.
