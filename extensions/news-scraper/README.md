# @figura/news-scraper

Configurable RSS/Atom feed collector for daily news briefings. Provide your own sources and get a consolidated summary.

## Features

- Fetches articles from any RSS 2.0 or Atom feed
- Configurable sources with category tagging
- Deduplication by URL across feeds within a source
- Date-sorted output (most recent first)
- Multi-language report: English, Portuguese (pt-BR), Spanish (es)

## Usage

```bash
# Pull the extension
swamp extension pull @figura/news-scraper

# Create a model with your sources
swamp model create @figura/news-scraper my-news \
  --global-arg 'sources:json=[
    {
      "name": "BBC News",
      "feeds": [
        { "url": "https://feeds.bbci.co.uk/news/rss.xml", "category": "general" },
        { "url": "https://feeds.bbci.co.uk/news/technology/rss.xml", "category": "technology" }
      ]
    },
    {
      "name": "Hacker News",
      "feeds": [
        { "url": "https://hnrss.org/frontpage", "category": "tech" }
      ]
    }
  ]' \
  --global-arg articlesPerSource=10 \
  --global-arg language=en

# Gather news
swamp model method run my-news gather

# View collected data
swamp data get my-news brief --json
```

## Global Arguments

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `sources` | array | *required* | Array of news sources with name and feeds |
| `articlesPerSource` | integer | 10 | Max articles to keep per source (1–50) |
| `language` | string | `"en"` | Report language: `en`, `pt-BR`, or `es` |

## Source Configuration

Each source in the `sources` array has:

```json
{
  "name": "Display Name",
  "feeds": [
    { "url": "https://example.com/feed.xml", "category": "general" }
  ]
}
```

- **name** — Display name shown in reports
- **feeds** — One or more RSS/Atom feed URLs
  - **url** — Full URL to the feed
  - **category** — Category label (used for grouping in reports)

## Workflow Example

Create a daily morning briefing:

```bash
swamp workflow create morning-news
```

Then edit the workflow YAML:

```yaml
trigger:
  schedule: "0 7 * * *"
reports:
  require:
    - "@figura/news-summary"
jobs:
  - name: gather
    steps:
      - name: scrape
        task:
          type: model_method
          modelIdOrName: my-news
          methodName: gather
```

## Report

The `@figura/news-summary` report (scope: workflow) generates:

- **Markdown**: Top 10 headlines across all sources, then per-source sections grouped by category
- **JSON**: Structured data with article metadata for downstream consumption

## License

MIT
