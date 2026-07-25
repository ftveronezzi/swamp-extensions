/**
 * News Scraper — configurable RSS/Atom feed collector that scrapes news from
 * any set of sources the user provides. Produces a consolidated brief of the
 * latest articles for daily summaries and downstream workflows.
 *
 * Sources are configured via globalArguments as a JSON array of feed configs:
 * ```json
 * [
 *   { "name": "G1", "feeds": [{ "url": "https://g1.globo.com/rss/g1/", "category": "geral" }] },
 *   { "name": "BBC", "feeds": [{ "url": "https://www.bbc.com/portuguese/index.xml", "category": "geral" }] }
 * ]
 * ```
 *
 * @module
 */

import { z } from "npm:zod@4.4.3";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const FeedSchema = z.object({
  url: z.string().url().describe("RSS or Atom feed URL"),
  category: z.string().default("general").describe(
    "Category label for articles from this feed",
  ),
});

const SourceConfigSchema = z.object({
  name: z.string().describe(
    "Display name of the news source (e.g. 'BBC', 'G1', 'Hacker News')",
  ),
  feeds: z.array(FeedSchema).min(1).describe(
    "One or more RSS/Atom feed URLs for this source",
  ),
});

const GlobalArgsSchema = z.object({
  sources: z.array(SourceConfigSchema).min(1)
    .describe(
      "Array of news sources to scrape. Each source has a name and one or more RSS/Atom feed URLs.",
    ),
  articlesPerSource: z.number().int().min(1).max(50).default(10)
    .describe("Maximum number of articles to keep per source"),
  language: z.string().default("en")
    .describe("Language hint for the report (e.g. 'en', 'pt-BR', 'es')"),
}).strict();

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

interface MethodContext {
  globalArgs: GlobalArgs;
  writeResource: (spec: string, instance: string, data: unknown) => Promise<
    { name: string; spec: string; instance: string }
  >;
  logger: { info: (msg: string, props?: Record<string, unknown>) => void };
}

const ArticleSchema = z.object({
  title: z.string(),
  url: z.string(),
  source: z.string(),
  category: z.string().default(""),
  date: z.string().default(""),
  summary: z.string().default(""),
});

const SourceResultSchema = z.object({
  source: z.string(),
  articles: z.array(ArticleSchema),
  fetchedAt: z.string(),
  error: z.string().default(""),
});

const NewsBriefSchema = z.object({
  sources: z.array(SourceResultSchema),
  totalArticles: z.number(),
  config: z.object({
    articlesPerSource: z.number(),
    language: z.string(),
    sourcesCount: z.number(),
  }),
  fetchedAt: z.string(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities. */
function stripHtml(input: string): string {
  const noTags = input.replace(/<[^>]*>/g, " ");
  const decoded = noTags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&apos;/g, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "swamp-news-scraper/1.0",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.text();
}

interface ParsedArticle {
  title: string;
  url: string;
  date: string;
  summary: string;
}

/** Parse RSS/Atom XML into article items. */
function parseRssFeed(xml: string): ParsedArticle[] {
  const articles: ParsedArticle[] = [];

  // Try RSS 2.0 <item> format first
  const items = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
  if (items.length > 0) {
    for (const item of items) {
      const content = item[1];
      const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const link = content.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      const pubDate = content.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
      const description = content.match(
        /<description[^>]*>([\s\S]*?)<\/description>/i,
      );

      articles.push({
        title: title
          ? stripHtml(title[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
          : "",
        url: link
          ? stripHtml(link[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
          : "",
        date: pubDate ? stripHtml(pubDate[1]) : "",
        summary: description
          ? stripHtml(
            description[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
          ).slice(0, 500)
          : "",
      });
    }
    return articles;
  }

  // Try Atom <entry> format
  const entries = [...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)];
  for (const entry of entries) {
    const content = entry[1];
    const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const link = content.match(/<link[^>]*href="([^"]+)"/i);
    const published =
      content.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
      content.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
    const summary = content.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
      content.match(/<content[^>]*>([\s\S]*?)<\/content>/i);

    articles.push({
      title: title
        ? stripHtml(title[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
        : "",
      url: link ? link[1] : "",
      date: published ? stripHtml(published[1]) : "",
      summary: summary
        ? stripHtml(summary[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
          .slice(0, 500)
        : "",
    });
  }

  return articles;
}

/** Fetch and parse all feeds for a single source. */
async function gatherSource(
  source: z.infer<typeof SourceConfigSchema>,
  maxArticles: number,
): Promise<z.infer<typeof SourceResultSchema>> {
  const allArticles: z.infer<typeof ArticleSchema>[] = [];
  const seenUrls = new Set<string>();
  const errors: string[] = [];

  for (const feed of source.feeds) {
    try {
      const xml = await fetchText(feed.url);
      const parsed = parseRssFeed(xml);

      for (const article of parsed) {
        if (article.url && !seenUrls.has(article.url)) {
          seenUrls.add(article.url);
          allArticles.push({
            title: article.title,
            url: article.url,
            source: source.name,
            category: feed.category,
            date: article.date,
            summary: article.summary,
          });
        }
      }
    } catch (err) {
      errors.push(`${feed.url}: ${(err as Error).message}`);
    }
  }

  // Sort by date (most recent first) and limit
  allArticles.sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0;
    const dateB = b.date ? new Date(b.date).getTime() : 0;
    return dateB - dateA;
  });

  return {
    source: source.name,
    articles: allArticles.slice(0, maxArticles),
    fetchedAt: new Date().toISOString(),
    error: errors.length > 0 ? errors.join("; ") : "",
  };
}

// ─── Methods ──────────────────────────────────────────────────────────────────

/** Gather articles from all configured news sources. */
async function gatherAll(
  _args: Record<string, never>,
  ctx: MethodContext,
): Promise<
  { dataHandles: { spec: string; instance: string; name: string }[] }
> {
  const cfg = ctx.globalArgs;
  ctx.logger.info(
    `Gathering news from ${cfg.sources.length} sources (${cfg.articlesPerSource} articles/source, lang=${cfg.language})`,
  );

  const results = await Promise.all(
    cfg.sources.map((source) => gatherSource(source, cfg.articlesPerSource)),
  );

  const totalArticles = results.reduce((sum, r) => sum + r.articles.length, 0);
  ctx.logger.info(
    `Gathered ${totalArticles} articles from ${results.length} sources`,
  );

  // Log any errors
  for (const r of results) {
    if (r.error) {
      ctx.logger.info(`Warning for ${r.source}: ${r.error}`);
    }
  }

  const brief = {
    sources: results,
    totalArticles,
    config: {
      articlesPerSource: cfg.articlesPerSource,
      language: cfg.language,
      sourcesCount: cfg.sources.length,
    },
    fetchedAt: new Date().toISOString(),
  };

  const handle = await ctx.writeResource("news-brief", "brief", brief);

  return { dataHandles: [handle] };
}

// ─── Model Export ─────────────────────────────────────────────────────────────

/** Configurable News Scraper model. */
export const model = {
  type: "@figura/news-scraper" as const,
  version: "2026.07.24.2",
  globalArguments: GlobalArgsSchema,
  resources: {
    "news-brief": {
      description:
        "Consolidated brief of latest news articles from all configured RSS/Atom sources",
      schema: NewsBriefSchema,
      lifetime: "4h" as const,
      garbageCollection: 5,
    },
  },
  methods: {
    gather: {
      description:
        "Gather news articles from all configured RSS/Atom feed sources. Fetches, deduplicates, and sorts articles by date.",
      arguments: z.object({}),
      execute: gatherAll,
    },
  },
};
