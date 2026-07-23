# @local/terraform-scanner

LLM-powered Terraform code quality scanner. Analyzes repositories (local or GitLab remote) for naming convention consistency, internal module usage patterns, code organization, and Terraform best practices.

Uses a LiteLLM-compatible API for intelligent pattern detection and produces structured findings with severity, suggestions, and agent-consumable output.

## Installation

```bash
swamp extension pull @local/terraform-scanner
```

## Authentication

- **LLM**: LiteLLM-compatible base URL + API key (stored in a swamp vault)
- **GitLab** (optional): host + personal access token for remote repo scanning

## Methods

| Method | Description |
|--------|-------------|
| `scan` | Scan a Terraform repo for code quality issues |

The `scan` method accepts a local path or GitLab project, analyzes all `.tf` files, and produces findings categorized by:

- **Naming conventions** — resource/variable/module naming consistency
- **Module usage** — internal module patterns and anti-patterns
- **Organization** — file structure, separation of concerns
- **Best practices** — general Terraform hygiene (backends, versions, etc.)

## Reports

Includes a companion report (`terraform_scan_report`) that transforms scan output into:

- **Markdown**: Executive summary, findings by severity, pattern analysis, file-level details
- **JSON**: Structured data for agent consumption and automated follow-up

## Usage

```bash
# Scan a local Terraform directory
swamp model method run tf-scanner scan --set path=/path/to/terraform/repo

# Scan a remote GitLab project
swamp model method run tf-scanner scan --set gitlabProject=my-group/infra-repo

# Run the report after scanning
swamp report run terraform_scan_report
```

## License

MIT — see [LICENSE.md](./LICENSE.md).
