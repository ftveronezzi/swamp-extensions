# @figura/cribl-stream

Read-only integration for troubleshooting [Cribl Stream](https://cribl.io/) Cloud deployments via the REST API.

## Features

- List and inspect sources, routes, pipelines, and destinations
- Capture live events at any pipeline point
- Browse lookup files and knowledge objects (parsers, global variables, schemas)
- Fan-out health check across all components in a worker group

All methods are **read-only** — no mutations are performed on your Cribl environment.

## Installation

```bash
swamp extension pull @figura/cribl-stream
```

## Authentication

Requires a Cribl Cloud API Client ID and Client Secret (OAuth2 `client_credentials` grant).
Generate credentials in Cribl Cloud under **Settings → API Credentials** and store them in a swamp vault.

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

## Usage

```bash
# List all sources in the "default" worker group
swamp model method run cribl list_sources --set workerGroup=default

# Get detailed config for a specific pipeline
swamp model method run cribl get_pipeline --set workerGroup=default --set pipelineId=my-syslog-pipeline

# Capture 5 live events from a source
swamp model method run cribl capture_events --set workerGroup=default --set sourceId=syslog-in --set maxEvents=5

# Run a health check across the worker group
swamp model method run cribl health --set workerGroup=default
```

## License

MIT — see [LICENSE.md](./LICENSE.md).
