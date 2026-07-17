# @figura/cribl-stream

Read-only integration for troubleshooting [Cribl Stream](https://cribl.io/) Cloud deployments via the REST API.

## Features

- List and inspect sources, routes, pipelines, and destinations
- Capture live events at any pipeline point
- Browse lookup files and knowledge objects (parsers, global variables, schemas)
- Fan-out health check across all components in a worker group

All methods are **read-only** — no mutations are performed on your Cribl environment.

## Authentication

Requires a Cribl Cloud API Client ID and Client Secret (OAuth2 `client_credentials` grant). Generate credentials in Cribl Cloud under **Settings → API Credentials**.

Store the credentials in a swamp vault.

## Usage Example

```typescript
import { model } from "@figura/cribl-stream";

// List all sources in the "default" worker group
const result = await model.methods.list_sources.execute(
  { workerGroup: "default" },
  context,
);

// Get detailed config for a specific pipeline
const pipeline = await model.methods.get_pipeline.execute(
  { workerGroup: "default", pipelineId: "my-syslog-pipeline" },
  context,
);

// Capture 5 live events from a source
const events = await model.methods.capture_events.execute(
  { workerGroup: "default", sourceId: "syslog-in", maxEvents: 5 },
  context,
);

// Run a health check across the worker group
const health = await model.methods.health.execute(
  { workerGroup: "default" },
  context,
);
```

## Methods

| Method | Description |
|--------|-------------|
| `list_sources` | List all input sources in a worker group |
| `get_source` | Get detailed config for a specific source |
| `list_routes` | List routes with filter, pipeline, and output mappings |
| `list_pipelines` | List all pipelines in a worker group |
| `get_pipeline` | Get pipeline config including all functions |
| `list_destinations` | List output destinations with status |
| `get_destination` | Get detailed config for a destination |
| `capture_events` | Capture/preview live events at a pipeline point |
| `list_lookups` | List lookup files in a worker group |
| `list_knowledge` | List knowledge objects (parsers, vars, schemas) |
| `health` | Fan-out health check across all components |

## License

MIT — see [LICENSE](../../LICENSE) in the repository root.
