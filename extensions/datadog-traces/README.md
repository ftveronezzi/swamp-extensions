# @figura/datadog/traces

Search and aggregate APM trace spans via the [Datadog Spans API (v2)](https://docs.datadoghq.com/api/latest/spans/).

Supports all Datadog sites: us1, us3, us5, eu1, ap1, us1-fed.

## Installation

```bash
swamp extension pull @figura/datadog/traces
```

## Authentication

Requires a Datadog API key (`DD-API-KEY`) and Application key (`DD-APPLICATION-KEY`), stored in a swamp vault.

## Methods

| Method | Description |
|--------|-------------|
| `list_spans` | Search APM trace spans with filter query, time range, and sort order |
| `aggregate_spans` | Compute metrics/timeseries over spans (count, avg, percentiles, group-by facets) |

## Usage

```bash
# Search for error spans in the last 15 minutes
swamp model method run dd-traces list_spans \
  --set filter_query="status:error" \
  --set filter_from="now-15m" \
  --set filter_to="now"

# Search spans for a specific service
swamp model method run dd-traces list_spans \
  --set filter_query="service:web-store AND resource_name:GET /api/v1/users" \
  --set filter_from="now-1h" \
  --set sort="-timestamp"

# Aggregate: count spans by service in the last hour
swamp model method run dd-traces aggregate_spans \
  --set filter='{"query":"*","from":"now-1h","to":"now"}' \
  --set compute='[{"aggregation":"count","type":"total"}]' \
  --set group_by='[{"facet":"service","limit":10,"sort":{"aggregation":"count","order":"desc"}}]'
```

## Related Extensions

- [@webframp/datadog/logs](https://swamp.dev/extensions/@webframp/datadog/logs) — Datadog log search and analytics
- [@webframp/datadog/metrics](https://swamp.dev/extensions/@webframp/datadog/metrics) — Datadog metric queries

## License

MIT — see [LICENSE.md](./LICENSE.md).
