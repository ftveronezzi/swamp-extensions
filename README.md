# swamp-extensions

A collection of [Swamp](https://swamp.dev) extensions for integrating with external services.

## Extensions

| Extension | Description |
|-----------|-------------|
| [@figura/cribl-stream](./models/cribl-stream/) | Read-only troubleshooting integration for Cribl Stream Cloud (sources, pipelines, routes, destinations, event capture, health checks) |
| [@figura/gitlab-mr-threads](./models/gitlab-mr-threads/) | Fetch, reply to, and resolve MR discussion threads via the GitLab REST API |

## Installation

Install extensions directly from the Swamp registry:

```bash
swamp install @figura/cribl-stream
swamp install @figura/gitlab-mr-threads
```

## License

MIT — see [LICENSE](./LICENSE).
