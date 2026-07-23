# @figura/gitlab-mr-threads

Fetch, reply to, and resolve MR discussion threads via the [GitLab REST API](https://docs.gitlab.com/ee/api/discussions.html).

Complements [@webframp/gitlab](https://swamp.dev/extensions/@webframp/gitlab) (general MR notes) and [@webframp/gitlab-review](https://swamp.dev/extensions/@webframp/gitlab-review) (diff-based reviews) by exposing the thread/discussion lifecycle: list unresolved threads, reply within a thread, and resolve threads programmatically.

## Installation

```bash
swamp extension pull @figura/gitlab-mr-threads
```

## Authentication

Requires a GitLab personal access token with `api` scope, stored in a swamp vault.

## Methods

| Method | Description |
|--------|-------------|
| `list_mr_threads` | Fetch all discussion threads on an MR with resolution status and file position context |
| `reply_to_thread` | Post a reply to an existing discussion thread |
| `resolve_thread` | Resolve or unresolve a discussion thread |

## Usage

```bash
# List all unresolved threads on MR !42 in project 123
swamp model method run gitlab-threads list_mr_threads \
  --set projectId=123 --set mrIid=42

# Reply to a thread
swamp model method run gitlab-threads reply_to_thread \
  --set projectId=123 --set mrIid=42 --set discussionId=abc123 \
  --set body="Fixed in the latest commit."

# Resolve a thread
swamp model method run gitlab-threads resolve_thread \
  --set projectId=123 --set mrIid=42 --set discussionId=abc123 \
  --set resolved=true
```

## License

MIT — see [LICENSE.md](./LICENSE.md).
