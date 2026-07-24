// Datadog API Helper
// Shared utilities for Datadog extension models

const DD_SITES: Record<string, string> = {
  us1: "https://api.datadoghq.com",
  us3: "https://us3.datadoghq.com",
  us5: "https://us5.datadoghq.com",
  eu1: "https://api.datadoghq.eu",
  ap1: "https://ap1.datadoghq.com",
  "us1-fed": "https://api.ddog-gov.com",
};

export interface PaginatedResult {
  results: Record<string, unknown>[];
  truncated: boolean;
  totalFetched: number;
}

function getBaseUrl(site: string): string {
  return DD_SITES[site] ?? DD_SITES.us1;
}

const MAX_PAGES = 20;

/**
 * Make a single Datadog API request.
 *
 * Handles:
 * - Site-based URL resolution
 * - Two-header auth (DD-API-KEY + DD-APPLICATION-KEY)
 * - 429 rate limit retry (once, using Retry-After header)
 * - JSON:API response flattening (when data has id/type/attributes)
 */
export async function ddApi(
  apiKey: string,
  appKey: string,
  site: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const baseUrl = getBaseUrl(site);
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": appKey,
    "Accept": "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 429 rate limit: read Retry-After, wait, retry once
  if (response.status === 429) {
    const retryAfter = Math.min(
      parseInt(response.headers.get("Retry-After") ?? "5", 10),
      60,
    );
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Datadog API rate limited (429) after retry: ${text.slice(0, 500)}`,
      );
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Datadog API HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  if (response.status === 204) {
    return {};
  }

  const json = await response.json();

  if (json && typeof json === "object" && "data" in json) {
    const data = json.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if ("id" in data && "type" in data && "attributes" in data) {
        return flattenJsonApiItem(data as Record<string, unknown>);
      }
    }
    return json as Record<string, unknown>;
  }

  return json as Record<string, unknown>;
}

/**
 * Paginated POST search request (body-based cursor pagination).
 *
 * For Datadog search endpoints that accept {filter, page: {cursor, limit}}
 * in the request body and return {data: [...], meta: {page: {after: "..."}}}
 */
export async function ddApiPostPaginated(
  apiKey: string,
  appKey: string,
  site: string,
  path: string,
  body: Record<string, unknown>,
  cursorResponsePath = "meta.page.after",
): Promise<PaginatedResult> {
  const baseUrl = getBaseUrl(site);
  const allResults: Record<string, unknown>[] = [];
  let page = 0;
  let truncated = false;

  const headers: Record<string, string> = {
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": appKey,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  let cursor: string | null = null;

  while (page < MAX_PAGES) {
    const requestBody = { ...body };
    if (cursor) {
      requestBody.page = {
        ...(requestBody.page as Record<string, unknown> ?? {}),
        cursor,
      };
    }

    const url = `${baseUrl}${path}`;
    let response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    // 429 retry
    if (response.status === 429) {
      const retryAfter = Math.min(
        parseInt(response.headers.get("Retry-After") ?? "5", 10),
        60,
      );
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Datadog API rate limited (429) after retry on page ${page}: ${
            text.slice(0, 300)
          }`,
        );
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Datadog API HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    const json = await response.json();
    const items = extractItems(json);
    allResults.push(...items);

    cursor = getNestedValue(json, cursorResponsePath) as string | null;
    if (!cursor || items.length === 0) break;

    page++;
  }

  if (page >= MAX_PAGES && cursor) {
    truncated = true;
  }

  return { results: allResults, truncated, totalFetched: allResults.length };
}

/**
 * Extract items from a Datadog API response.
 */
function extractItems(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];

  const obj = json as Record<string, unknown>;

  if (Array.isArray(obj.data)) {
    return obj.data.map((item: unknown) => {
      if (item && typeof item === "object") {
        const i = item as Record<string, unknown>;
        if ("id" in i && "type" in i && "attributes" in i) {
          return flattenJsonApiItem(i);
        }
        return i;
      }
      return {};
    });
  }

  for (
    const key of ["results", "items", "records", "spans", "events"]
  ) {
    if (Array.isArray(obj[key])) {
      return obj[key] as Record<string, unknown>[];
    }
  }

  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
    const data = obj.data as Record<string, unknown>;
    if ("id" in data && "type" in data && "attributes" in data) {
      return [flattenJsonApiItem(data)];
    }
    return [data];
  }

  const metadataKeys = new Set([
    "warnings",
    "errors",
    "included",
    "links",
    "meta",
  ]);
  for (const [key, value] of Object.entries(obj)) {
    if (metadataKeys.has(key)) continue;
    if (Array.isArray(value) && value.length > 0) {
      return value as Record<string, unknown>[];
    }
  }

  return [];
}

/**
 * Flatten a JSON:API item: merge id + type + attributes into flat object.
 */
function flattenJsonApiItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (item.id !== undefined) result.id = item.id;
  if (item.type !== undefined) result.type = item.type;

  if (item.attributes && typeof item.attributes === "object") {
    const attrs = item.attributes as Record<string, unknown>;
    for (const [key, value] of Object.entries(attrs)) {
      result[key] = value;
    }
  }

  if (item.relationships && typeof item.relationships === "object") {
    const rels = item.relationships as Record<string, unknown>;
    for (const [name, rel] of Object.entries(rels)) {
      if (rel && typeof rel === "object") {
        const relData = (rel as Record<string, unknown>).data;
        if (relData && typeof relData === "object") {
          result[`${name}_id`] = (relData as Record<string, unknown>).id;
        }
      }
    }
  }

  return result;
}

/**
 * Get a nested value from an object by dot-path (e.g., "meta.page.after").
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}
