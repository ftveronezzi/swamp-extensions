# @figura/datadog/rbac

Role, permission, user, and restriction query analysis via the [Datadog RBAC API (v2)](https://docs.datadoghq.com/api/latest/roles/).

Answers "who can access what data?" by resolving the full chain: user → roles → permissions + restriction queries → effective access.

Supports all Datadog sites: us1, us3, us5, eu1, ap1, us1-fed.

## Installation

```bash
swamp extension pull @figura/datadog/rbac
```

## Authentication

Requires a Datadog API key (`DD-API-KEY`) and Application key (`DD-APPLICATION-KEY`), stored in a swamp vault.

## Methods

| Method | Description |
|--------|-------------|
| `list_roles` | List all roles with their assigned permissions |
| `list_users` | List all users with role assignments |
| `list_permissions` | Full permission catalog (maps IDs to human-readable names) |
| `list_restriction_queries` | Dataset-level filters for logs, traces, events, and RUM |
| `analyze_access` | Resolve effective access for a specific user (by email) or role (by name) |

## Reports

| Report | Scope | Description |
|--------|-------|-------------|
| `@figura/datadog-rbac-report` | workflow | Permission matrix, restriction query breakdown, and security observations |

## Usage

```bash
# List all roles with their permissions
swamp model method run dd-rbac list_roles

# List all restriction queries (data access filters)
swamp model method run dd-rbac list_restriction_queries

# Filter by data type
swamp model method run dd-rbac list_restriction_queries --input data_type=logs

# Analyze effective access for a specific user
swamp model method run dd-rbac analyze_access --input user_email=jane@example.com

# Analyze access for a specific role
swamp model method run dd-rbac analyze_access --input role_name="Datadog Read Only Role"

# List all users with their role assignments
swamp model method run dd-rbac list_users --input filter_status=Active
```

## How It Works

The `analyze_access` method resolves the full permission chain:

1. Finds the user by email (fuzzy match on email, handle, or name)
2. Resolves their role assignments
3. Fetches all permissions granted by those roles
4. Queries restriction queries for each data type (logs, events, spans, RUM)
5. Determines effective access — unrestricted, restricted (with filter), or no permission

## Related Extensions

- [@figura/datadog/traces](https://swamp.dev/extensions/@figura/datadog/traces) — Datadog APM trace search and aggregation
- [@webframp/datadog/logs](https://swamp.dev/extensions/@webframp/datadog/logs) — Datadog log search and analytics
- [@webframp/datadog/teams](https://swamp.dev/extensions/@webframp/datadog/teams) — Datadog team management and memberships

## License

MIT — see [LICENSE.md](./LICENSE.md).
