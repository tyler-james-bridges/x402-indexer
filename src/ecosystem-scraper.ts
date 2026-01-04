/**
 * Ecosystem Page Scraper
 *
 * Scrapes x402 services from the x402.org/ecosystem page.
 * This provides an alternative data source since the discovery API is deprecated.
 */

import { fetchWithTimeout } from "./utils/fetch-with-timeout.js";
import { type EcosystemService } from "./schemas.js";
import { createLogger, type Logger } from "./logger.js";

/**
 * Result of scraping the ecosystem page
 */
export interface EcosystemScrapeResult {
  services: EcosystemService[];
  errors: string[];
}


/**
 * Extracts a clean URL from various link formats
 */
function extractUrl(href: string): string | null {
  if (!href) return null;

  // Handle relative URLs
  if (href.startsWith("/")) {
    return `https://www.x402.org${href}`;
  }

  // Handle protocol-relative URLs
  if (href.startsWith("//")) {
    return `https:${href}`;
  }

  // Handle normal URLs
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }

  return null;
}


/**
 * Parses the ecosystem HTML to extract services
 * Uses regex-based parsing since we don't have a DOM parser
 */
function parseEcosystemHtml(html: string, logger: Logger): EcosystemService[] {
  const services: EcosystemService[] = [];
  const seen = new Set<string>();

  // The ecosystem page has sections with tables containing service info
  // Each table row typically has: Name (with link), Description

  // Pattern to match table rows with links and descriptions
  // Looking for patterns like: <a href="...">Name</a> ... description text
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;

  // Also look for structured data in the page
  // The page uses Next.js, so data might be in script tags
  const jsonDataPattern = /<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/i;
  const jsonMatch = html.match(jsonDataPattern);

  if (jsonMatch && jsonMatch[1]) {
    try {
      const nextData = JSON.parse(jsonMatch[1]);
      // Try to extract services from Next.js page props
      const pageProps = nextData?.props?.pageProps;
      if (pageProps?.services && Array.isArray(pageProps.services)) {
        for (const service of pageProps.services) {
          if (service.name && service.url && !seen.has(service.url)) {
            seen.add(service.url);
            services.push({
              name: service.name,
              url: service.url,
              description: service.description || "",
              category: service.category || "Uncategorized",
            });
          }
        }
        logger.debug(`Extracted ${services.length} services from Next.js data`);
        return services;
      }
    } catch {
      logger.debug("Failed to parse Next.js data, falling back to HTML parsing");
    }
  }

  // Fallback: Parse HTML structure
  // Look for table-like structures with service info

  // Pattern for ecosystem entries - usually in format:
  // Service name linked to URL, followed by description
  const entryPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/td>[\s\S]*?<\/tr>/gi;

  let match;
  while ((match = entryPattern.exec(html)) !== null) {
    const href = match[1];
    const name = match[2];
    const descHtml = match[3];
    if (!href || !name) continue;
    const url = extractUrl(href);
    if (url && !seen.has(url)) {
      seen.add(url);
      // Strip HTML tags from description
      const description = descHtml ? descHtml.replace(/<[^>]+>/g, "").trim() : "";
      services.push({
        name: name.trim(),
        url,
        description,
        category: "Uncategorized",
      });
    }
  }

  // Also try to find links with descriptions in other formats
  const cardPattern = /<div[^>]*class="[^"]*card[^"]*"[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>[\s\S]*?<p[^>]*>([^<]+)<\/p>[\s\S]*?<\/div>/gi;

  while ((match = cardPattern.exec(html)) !== null) {
    const href = match[1];
    const name = match[2];
    const description = match[3];
    if (!href || !name) continue;
    const url = extractUrl(href);
    if (url && !seen.has(url)) {
      seen.add(url);
      services.push({
        name: name.trim(),
        url,
        description: description ? description.trim() : "",
        category: "Uncategorized",
      });
    }
  }

  // As a last resort, just find all external links with reasonable names
  if (services.length === 0) {
    logger.debug("Structured parsing failed, extracting all links");
    while ((match = linkPattern.exec(html)) !== null) {
      const href = match[1];
      const name = match[2];
      if (!href || !name) continue;
      const url = extractUrl(href);

      // Filter out navigation links, assets, and internal links
      if (
        url &&
        name &&
        !seen.has(url) &&
        !url.includes("x402.org") &&
        !url.includes("_next") &&
        !url.includes("github.com/coinbase/x402") &&
        name.length > 2 &&
        name.length < 50 &&
        !name.toLowerCase().includes("learn more") &&
        !name.toLowerCase().includes("get started")
      ) {
        seen.add(url);
        services.push({
          name: name.trim(),
          url,
          description: "",
          category: "Uncategorized",
        });
      }
    }
  }

  logger.debug(`Extracted ${services.length} services from HTML parsing`);
  return services;
}

/**
 * Scrapes the x402.org ecosystem page for services
 */
export async function scrapeEcosystem(
  ecosystemUrl: string,
  timeoutMs: number,
  verbose: boolean
): Promise<EcosystemScrapeResult> {
  const logger = createLogger(verbose);
  const errors: string[] = [];

  logger.info(`Scraping ecosystem page: ${ecosystemUrl}`);

  try {
    const response = await fetchWithTimeout(ecosystemUrl, {
      timeoutMs,
      method: "GET",
      headers: {
        Accept: "text/html",
        "User-Agent": "x402-indexer/1.0",
      },
    });

    if (!response.ok) {
      const errorMsg = `Ecosystem page returned ${response.status}: ${response.statusText}`;
      logger.warn(errorMsg);
      return { services: [], errors: [errorMsg] };
    }

    const html = await response.text();
    logger.debug(`Fetched ${html.length} bytes from ecosystem page`);

    const services = parseEcosystemHtml(html, logger);
    logger.info(`Scraped ${services.length} services from ecosystem page`);

    return { services, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Failed to scrape ecosystem page: ${errorMsg}`);
    return { services: [], errors: [errorMsg] };
  }
}
