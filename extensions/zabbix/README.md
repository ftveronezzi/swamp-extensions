# @figura/zabbix

Read-only integration for troubleshooting and observing monitored infrastructure via the [Zabbix JSON-RPC 2.0 API](https://www.zabbix.com/documentation/current/en/manual/api).

Retrieves hosts, problems, triggers, items, history, host groups, maintenance windows, events, and network maps.

## Installation

```bash
swamp extension pull @figura/zabbix
```

## Authentication

Requires a Zabbix API Token, stored in a swamp vault. Generate one in Zabbix under **Administration → API Tokens**.

## Methods

| Method | Description |
|--------|-------------|
| `get_hosts` | List monitored hosts with status, availability, and groups |
| `get_host_detail` | Get detailed host info (interfaces, macros, inventory) |
| `get_problems` | List active problems/alerts with severity |
| `get_triggers` | List triggers with state and associated hosts |
| `get_items` | List monitoring items (metrics) for a host |
| `get_history` | Get recent history/metric values for an item |
| `get_host_groups` | List all host groups |
| `get_maintenance` | List maintenance windows |
| `get_events` | Get recent events (state changes, alerts) |
| `get_map` | Retrieve a network map with elements and links |

## Usage

```bash
# List all monitored hosts
swamp model method run zabbix get_hosts

# Get active problems with severity >= High
swamp model method run zabbix get_problems --set minSeverity=4

# Get recent history for a specific item
swamp model method run zabbix get_history --set itemId=12345 --set limit=10

# Get detailed info for a specific host
swamp model method run zabbix get_host_detail --set hostId=10084
```

## License

MIT — see [LICENSE.md](./LICENSE.md).
