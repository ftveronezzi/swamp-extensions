/**
 * News Summary Report — produces a formatted briefing from the news-scraper
 * model data. Groups articles by source, highlights top headlines, and
 * provides structured JSON for downstream consumption.
 *
 * Adapts language and formatting based on the configured language hint.
 *
 * @module
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Article {
  title: string;
  url: string;
  source: string;
  category: string;
  date: string;
  summary: string;
}

interface SourceResult {
  source: string;
  articles: Article[];
  fetchedAt: string;
  error: string;
}

interface NewsBrief {
  sources: SourceResult[];
  totalArticles: number;
  config: { articlesPerSource: number; language: string; sourcesCount: number };
  fetchedAt: string;
}

// ─── i18n ─────────────────────────────────────────────────────────────────────

interface I18n {
  title: string;
  topHeadlines: string;
  articlesCollected: (total: number, sources: number) => string;
  updated: string;
  noData: string;
  collectionErrors: string;
  noArticles: string;
  generatedAt: string;
}

const TRANSLATIONS: Record<string, I18n> = {
  en: {
    title: "News Summary",
    topHeadlines: "Top Headlines",
    articlesCollected: (t, s) =>
      `**${t}** articles collected from **${s}** sources`,
    updated: "Updated",
    noData:
      "Unable to retrieve news data. Check that the `gather` method ran successfully.",
    collectionErrors: "Collection errors",
    noArticles: "No articles available.",
    generatedAt: "Report generated automatically by swamp at",
  },
  "pt-BR": {
    title: "Resumo de Notícias",
    topHeadlines: "Principais Manchetes",
    articlesCollected: (t, s) =>
      `**${t}** artigos coletados de **${s}** fontes`,
    updated: "Atualizado",
    noData:
      "Não foi possível obter os dados de notícias. Verifique se o método `gather` foi executado com sucesso.",
    collectionErrors: "Erros na coleta",
    noArticles: "Nenhum artigo disponível.",
    generatedAt: "Relatório gerado automaticamente por swamp em",
  },
  es: {
    title: "Resumen de Noticias",
    topHeadlines: "Titulares Principales",
    articlesCollected: (t, s) =>
      `**${t}** artículos recopilados de **${s}** fuentes`,
    updated: "Actualizado",
    noData:
      "No se pudieron obtener los datos de noticias. Verifique que el método `gather` se ejecutó correctamente.",
    collectionErrors: "Errores en la recolección",
    noArticles: "No hay artículos disponibles.",
    generatedAt: "Informe generado automáticamente por swamp en",
  },
};

function getI18n(lang: string): I18n {
  return TRANSLATIONS[lang] || TRANSLATIONS["en"];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string, lang: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const locale = lang === "pt-BR" ? "pt-BR" : lang === "es" ? "es" : "en-US";
    return d.toLocaleDateString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatDateLong(lang: string): string {
  const now = new Date();
  const locale = lang === "pt-BR" ? "pt-BR" : lang === "es" ? "es" : "en-US";
  return now.toLocaleDateString(locale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function truncateSummary(summary: string, maxLen = 200): string {
  if (!summary) return "";
  if (summary.length <= maxLen) return summary;
  return summary.slice(0, maxLen) + "...";
}

// ─── Report ───────────────────────────────────────────────────────────────────

export const report = {
  name: "@figura/news-summary",
  description:
    "News summary report — formatted briefing with top headlines from configured sources. Supports multiple languages.",
  scope: "workflow" as const,
  labels: ["daily", "news", "summary", "rss"],
  execute: async (context: {
    workflowName: string;
    workflowStatus: string;
    stepExecutions: Array<{
      jobName: string;
      stepName: string;
      modelName: string;
      modelType: string;
      methodName: string;
      status: string;
      dataHandles: Array<{ name: string; version: number; specName: string }>;
      modelId: string;
    }>;
    dataRepository: {
      getContent: (
        type: string,
        modelId: string,
        dataName: string,
        version?: number,
      ) => Promise<Uint8Array | null>;
    };
  }) => {
    const now = new Date();

    // ─── Find the gather step data ──────────────────────────────────────
    const gatherStep = context.stepExecutions.find(
      (s) =>
        s.methodName === "gather" && s.modelType === "@figura/news-scraper",
    );

    let brief: NewsBrief | null = null;

    if (gatherStep?.status === "succeeded") {
      const handle = gatherStep.dataHandles.find(
        (h) => h.specName === "news-brief",
      );
      if (handle) {
        const raw = await context.dataRepository.getContent(
          gatherStep.modelType,
          gatherStep.modelId,
          handle.name,
          handle.version,
        );
        if (raw) {
          brief = JSON.parse(new TextDecoder().decode(raw));
        }
      }
    }

    const lang = brief?.config?.language || "en";
    const i18n = getI18n(lang);
    const dateLong = formatDateLong(lang);

    if (!brief) {
      const md = `# ❌ ${i18n.title} — ${dateLong}\n\n${i18n.noData}`;
      return {
        markdown: md,
        json: {
          date: now.toISOString(),
          error: "No data available",
          sources: [],
        },
      };
    }

    // ─── Build Markdown Report ──────────────────────────────────────────
    const lines: string[] = [];

    lines.push(`# 📰 ${i18n.title} — ${dateLong}`);
    lines.push("");
    lines.push(
      `> ${
        i18n.articlesCollected(brief.totalArticles, brief.sources.length)
      } | ${i18n.updated}: ${formatDate(brief.fetchedAt, lang)}`,
    );
    lines.push("");
    lines.push("---");
    lines.push("");

    // Top headlines (first 3 from each source)
    lines.push(`## 🔥 ${i18n.topHeadlines}`);
    lines.push("");

    const topArticles: Article[] = [];
    for (const source of brief.sources) {
      topArticles.push(...source.articles.slice(0, 3));
    }
    // Sort by date
    topArticles.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

    for (const article of topArticles.slice(0, 10)) {
      lines.push(
        `- **[${article.title}](${article.url})** _(${article.source})_`,
      );
      if (article.summary) {
        lines.push(`  > ${truncateSummary(article.summary, 150)}`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");

    // Per-source sections
    for (const source of brief.sources) {
      lines.push(`## ${source.source}`);
      lines.push("");

      if (source.error) {
        lines.push(`> ⚠️ ${i18n.collectionErrors}: ${source.error}`);
        lines.push("");
      }

      if (source.articles.length === 0) {
        lines.push(`_${i18n.noArticles}_`);
        lines.push("");
        continue;
      }

      // Group by category
      const byCategory = new Map<string, Article[]>();
      for (const article of source.articles) {
        const cat = article.category || "general";
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(article);
      }

      for (const [category, articles] of byCategory) {
        if (byCategory.size > 1) {
          lines.push(
            `### ${category.charAt(0).toUpperCase() + category.slice(1)}`,
          );
          lines.push("");
        }

        for (const article of articles) {
          const dateFormatted = article.date
            ? ` — _${formatDate(article.date, lang)}_`
            : "";
          lines.push(
            `- **[${article.title}](${article.url})**${dateFormatted}`,
          );
          if (article.summary) {
            lines.push(`  > ${truncateSummary(article.summary)}`);
          }
        }
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }

    // Footer
    lines.push("");
    lines.push(
      `_${i18n.generatedAt} ${formatDate(now.toISOString(), lang)}_`,
    );

    const md = lines.join("\n");

    // ─── Build JSON output ──────────────────────────────────────────────
    const json = {
      date: now.toISOString(),
      language: lang,
      totalArticles: brief.totalArticles,
      sourcesCount: brief.sources.length,
      sources: brief.sources.map((s) => ({
        name: s.source,
        articleCount: s.articles.length,
        categories: [...new Set(s.articles.map((a) => a.category))],
        topHeadlines: s.articles.slice(0, 5).map((a) => ({
          title: a.title,
          url: a.url,
          category: a.category,
          date: a.date,
        })),
        error: s.error || null,
      })),
      topHeadlines: topArticles.slice(0, 15).map((a) => ({
        title: a.title,
        url: a.url,
        source: a.source,
        category: a.category,
        date: a.date,
        summary: a.summary,
      })),
    };

    return { markdown: md, json };
  },
};
