/**
 * Ecosystem Page Scraper
 *
 * Scrapes x402 services from the x402.org/ecosystem page using Playwright.
 * Uses headless browser to properly render the React SPA and extract services.
 */

import { chromium, type Browser } from "playwright";
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
 * Scrapes ecosystem page using Playwright (headless browser)
 */
async function scrapeWithPlaywright(
  ecosystemUrl: string,
  timeoutMs: number,
  logger: Logger
): Promise<EcosystemService[]> {
  let browser: Browser | null = null;

  try {
    logger.debug("Launching headless browser...");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    logger.debug(`Navigating to ${ecosystemUrl}...`);
    await page.goto(ecosystemUrl, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });

    // Wait for content to render
    await page.waitForTimeout(2000);

    // Extract service cards from the rendered page
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawServices = await page.evaluate((): { name: string; url: string; desc: string }[] => {
      const results: { name: string; url: string; desc: string }[] = [];
      const seen = new Set<string>();

      // Find all card-like elements with external links
      document
        .querySelectorAll(
          '[class*="card"], [class*="Card"], article, [class*="item"], [class*="partner"], [class*="service"]'
        )
        .forEach((card: Element) => {
          const link = card.querySelector(
            'a[href^="http"]:not([href*="x402.org"]):not([href*="coinbase.com/legal"])'
          );
          if (!link) return;

          const url = link.getAttribute("href") || "";
          if (!url || seen.has(url)) return;

          // Get name from heading or link text
          const name =
            card
              .querySelector(
                'h2, h3, h4, [class*="title"], [class*="name"], [class*="Title"], [class*="Name"]'
              )
              ?.textContent?.trim() ||
            link.textContent?.trim() ||
            "";

          if (!name || name.length < 2 || name.length > 100) return;

          // Get description from paragraph
          const desc =
            card
              .querySelector(
                'p, [class*="desc"], [class*="Desc"], [class*="description"]'
              )
              ?.textContent?.trim() || "";

          seen.add(url);
          results.push({ name, url, desc });
        });

      return results;
    });

    logger.debug(`Playwright extracted ${rawServices.length} services`);

    // Convert to EcosystemService format with category inference
    const services: EcosystemService[] = rawServices
      .filter(
        (s) =>
          s.url &&
          s.name &&
          !s.url.includes("x402.org") &&
          !s.url.includes("coinbase.com/legal") &&
          !s.url.includes("google.com/forms")
      )
      .map((s) => ({
        name: s.name,
        url: s.url,
        description: s.desc,
        category: inferCategory(s.name, s.desc),
      }));

    return services;
  } finally {
    if (browser) {
      await browser.close();
    }
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
    const services = await scrapeWithPlaywright(ecosystemUrl, timeoutMs, logger);
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
