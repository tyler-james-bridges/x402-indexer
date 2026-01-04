/**
 * Ecosystem Page Scraper
 *
 * Scrapes x402 services from the x402.org/ecosystem page using cheerio.
 * Lightweight HTML parsing without requiring a headless browser.
 */

import * as cheerio from "cheerio";
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
 * Category mapping based on x402.org ecosystem page sections
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "AI Agents": ["agent", "ai", "llm", "inference", "model"],
  "Developer Tools": ["sdk", "client", "server", "api", "framework", "kit"],
  Infrastructure: ["facilitator", "gateway", "router", "payment", "wallet"],
  Analytics: ["analytics", "explorer", "scan", "monitor"],
  Marketplaces: ["marketplace", "market", "launchpad"],
  Examples: ["example", "reference", "demo"],
};

/**
 * Infers category from service name and description
 */
function inferCategory(name: string, description: string): string {
  const text = `${name} ${description}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return category;
    }
  }

  return "Services";
}

/**
 * Scrapes ecosystem page using cheerio (lightweight HTML parsing)
 */
async function scrapeWithCheerio(
  ecosystemUrl: string,
  timeoutMs: number,
  logger: Logger
): Promise<EcosystemService[]> {
  logger.debug(`Fetching ${ecosystemUrl}...`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ecosystemUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "x402-indexer/1.0",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const services: EcosystemService[] = [];
    const seen = new Set<string>();

    // Find all card-like elements with external links
    $(
      '[class*="card"], [class*="Card"], article, [class*="item"], [class*="partner"], [class*="service"]'
    ).each((_, card) => {
      const $card = $(card);
      const $link = $card.find(
        'a[href^="http"]:not([href*="x402.org"]):not([href*="coinbase.com/legal"])'
      );

      if ($link.length === 0) return;

      const url = $link.attr("href") || "";
      if (!url || seen.has(url)) return;

      // Get name from heading or link text
      const name =
        $card
          .find(
            'h2, h3, h4, [class*="title"], [class*="name"], [class*="Title"], [class*="Name"]'
          )
          .first()
          .text()
          .trim() ||
        $link.text().trim() ||
        "";

      if (!name || name.length < 2 || name.length > 100) return;

      // Get description from paragraph
      const desc =
        $card
          .find('p, [class*="desc"], [class*="Desc"], [class*="description"]')
          .first()
          .text()
          .trim() || "";

      // Filter out unwanted URLs
      if (
        url.includes("x402.org") ||
        url.includes("coinbase.com/legal") ||
        url.includes("google.com/forms")
      ) {
        return;
      }

      seen.add(url);
      services.push({
        name,
        url,
        description: desc,
        category: inferCategory(name, desc),
      });
    });

    logger.debug(`Cheerio extracted ${services.length} services`);
    return services;
  } finally {
    clearTimeout(timeoutId);
  }
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
    const services = await scrapeWithCheerio(ecosystemUrl, timeoutMs, logger);
    logger.info(`Scraped ${services.length} services from ecosystem page`);

    return { services, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Failed to scrape ecosystem page: ${errorMsg}`);
    errors.push(errorMsg);

    // Return empty on failure - don't block the indexer
    return { services: [], errors };
  }
}
