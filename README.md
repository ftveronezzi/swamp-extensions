# swamp-extensions

A collection of [Swamp](https://swamp.dev) extensions for integrating with external services.

## Extensions

| Extension | Description |
|-----------|-------------|
| [@figura/cribl-stream](./extensions/cribl-stream/) | Read-only troubleshooting integration for Cribl Stream Cloud (sources, pipelines, routes, destinations, event capture, health checks) |
| [@figura/gitlab-mr-threads](./extensions/gitlab-mr-threads/) | Fetch, reply to, and resolve MR discussion threads via the GitLab REST API |
| [@figura/zabbix](./extensions/zabbix/) | Read-only Zabbix monitoring integration (hosts, problems, triggers, items, history, maps) |
| [@figura/datadog/traces](./extensions/datadog-traces/) | Search and aggregate APM trace spans via the Datadog Spans API (v2) |
| [@local/terraform-scanner](./extensions/terraform-scanner/) | LLM-powered Terraform code quality scanner with report generation |

## Installation

Install extensions directly from the Swamp registry:

```bash
swamp extension pull @figura/cribl-stream
swamp extension pull @figura/gitlab-mr-threads
swamp extension pull @figura/zabbix
swamp extension pull @figura/datadog/traces
swamp extension pull @local/terraform-scanner
```

## Repository Structure

```
extensions/
├── cribl-stream/          # @figura/cribl-stream
│   ├── manifest.yaml
│   ├── models/
│   ├── README.md
│   └── LICENSE.md
├── gitlab-mr-threads/     # @figura/gitlab-mr-threads
│   ├── manifest.yaml
│   ├── models/
│   ├── README.md
│   └── LICENSE.md
├── zabbix/                # @figura/zabbix
│   ├── manifest.yaml
│   ├── models/
│   ├── README.md
│   └── LICENSE.md
├── datadog-traces/        # @figura/datadog/traces
│   ├── manifest.yaml
│   ├── models/datadog/
│   ├── README.md
│   └── LICENSE.md
└── terraform-scanner/     # @local/terraform-scanner
    ├── manifest.yaml
    ├── models/
    ├── reports/
    ├── README.md
    └── LICENSE.md
```

## License

MIT — see [LICENSE](./LICENSE).
