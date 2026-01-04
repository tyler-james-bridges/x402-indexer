/**
 * x402 Bazaar Indexer
 *
 * Main indexer logic that orchestrates fetching, health checking,
 * and enrichment of x402 resources.
 */

import {
  type IndexerConfig,
  type EnrichedResource,
  type IndexOutput,
  type IndexSummary,
  type DiscoveredResource,
  type EcosystemService,
  type PartnerMetadata,
  type PricingInfo,
} from "./schemas.js";
import { fetchResources } from "./fetcher.js";
import { checkEndpoints, type EndpointCheckResult } from "./health-checker.js";
import { createLogger } from "./logger.js";
import { VERSION } from "./version.js";
import type { Client } from "@libsql/client";
import {
  getInitializedDb,
  upsertResource,
  startIndexRun,
  completeIndexRun,
  failIndexRun,
} from "./db/index.js";
import type { Logger } from "./logger.js";

/**
 * Creates an enriched resource from a discovered resource and health check
 */
function enrichDiscoveredResource(
  resource: DiscoveredResource,
  checkResult: EndpointCheckResult | undefined,
  partnerMetadata?: PartnerMetadata
): EnrichedResource {
  // Extract networks from payment requirements
  const networksSupported = [
    ...new Set(resource.accepts.map((a) => a.network)),
  ];

  // Use check result or create a placeholder
  const health = checkResult?.health ?? {
    isAlive: false,
    error: "Health check skipped",
    checkedAt: new Date().toISOString(),
  };

  // Merge pricing from check result and original accepts
  const pricing: PricingInfo[] =
    checkResult?.pricing.length ?? 0 > 0
      ? checkResult!.pricing
      : resource.accepts.map((a) => ({
          scheme: a.scheme,
          network: a.network,
          maxAmountRequired: a.maxAmountRequired,
          asset: a.asset,
          payTo: a.payTo,
          maxTimeoutSeconds: a.maxTimeoutSeconds,
        }));

  return {
    url: resource.resource,
    name: partnerMetadata?.name,
    description:
      partnerMetadata?.description ??
      resource.accepts[0]?.description,
    category: partnerMetadata?.category,
    type: resource.type,
    x402Version: resource.x402Version,
    health,
    pricing,
    networksSupported,
    accepts: resource.accepts,
    lastUpdated:
      typeof resource.lastUpdated === "string"
        ? resource.lastUpdated
        : resource.lastUpdated.toISOString(),
    metadata: resource.metadata,
    source: "discovery_api",
  };
}

/**
 * Creates an enriched resource from partner metadata (for facilitators)
 */
function enrichPartnerMetadata(
  partner: PartnerMetadata,
  checkResult: EndpointCheckResult | undefined
): EnrichedResource | null {
  // Only process facilitators with baseUrl
  if (!partner.facilitator?.baseUrl) {
    return null;
  }

  const health = checkResult?.health ?? {
    isAlive: false,
    error: "Health check skipped",
    checkedAt: new Date().toISOString(),
  };

  return {
    url: partner.facilitator.baseUrl,
    name: partner.name,
    description: partner.description,
    category: partner.category,
    type: "http",
    x402Version: 1,
    health,
    pricing: checkResult?.pricing ?? [],
    networksSupported: partner.facilitator.networks,
    accepts: [],
    lastUpdated: new Date().toISOString(),
    metadata: {
      slug: partner.slug,
      logoUrl: partner.logoUrl,
      websiteUrl: partner.websiteUrl,
      facilitatorInfo: partner.facilitator,
    },
    source: "partners_data",
  };
}

/**
 * Creates an enriched resource from an ecosystem service
 */
function enrichEcosystemService(
  service: EcosystemService,
  checkResult: EndpointCheckResult | undefined
): EnrichedResource {
  const health = checkResult?.health ?? {
    isAlive: false,
    error: "Health check skipped",
    checkedAt: new Date().toISOString(),
  };

  // Extract networks from payment requirements if available
  const networksSupported =
    checkResult?.rawPaymentRequirements
      ?.map((r) => r.network)
      .filter((n, i, arr) => arr.indexOf(n) === i) ?? [];

  return {
    url: service.url,
    name: service.name,
    description: service.description,
    category: service.category,
    type: "http",
    x402Version: 1,
    health,
    pricing: checkResult?.pricing ?? [],
    networksSupported,
    accepts: checkResult?.rawPaymentRequirements ?? [],
    lastUpdated: new Date().toISOString(),
    metadata: {},
    source: "ecosystem",
  };
}

/**
 * Persists indexed resources to SQLite database
 */
async function persistToDatabase(
  db: Client,
  resources: EnrichedResource[],
  summary: IndexSummary,
  facilitatorUrl: string,
  logger: Logger
): Promise<void> {
  const runId = await startIndexRun(db, facilitatorUrl, VERSION);

  try {
    for (const resource of resources) {
      await upsertResource(db, resource);
    }
    await completeIndexRun(db, runId, summary);
    logger.info(`Saved ${resources.length} resources to database`);
  } catch (error) {
    await failIndexRun(
      db,
      runId,
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error;
  }
}

/**
 * Calculates summary statistics from enriched resources
 */
function calculateSummary(
  resources: EnrichedResource[],
  startTime: number
): IndexSummary {
  const aliveResources = resources.filter((r) => r.health.isAlive);
  const latencies = aliveResources
    .map((r) => r.health.latencyMs)
    .filter((l): l is number => l !== undefined);

  // Count by category
  const byCategory: Record<string, number> = {};
  for (const resource of resources) {
    const category = resource.category ?? "Uncategorized";
    byCategory[category] = (byCategory[category] ?? 0) + 1;
  }

  // Count by network
  const byNetwork: Record<string, number> = {};
  for (const resource of resources) {
    for (const network of resource.networksSupported) {
      byNetwork[network] = (byNetwork[network] ?? 0) + 1;
    }
  }

  const endTime = performance.now();

  return {
    totalResources: resources.length,
    aliveCount: aliveResources.length,
    deadCount: resources.length - aliveResources.length,
    avgLatencyMs:
      latencies.length > 0
        ? Math.round(
            latencies.reduce((a, b) => a + b, 0) / latencies.length
          )
        : undefined,
    minLatencyMs:
      latencies.length > 0 ? Math.min(...latencies) : undefined,
    maxLatencyMs:
      latencies.length > 0 ? Math.max(...latencies) : undefined,
    byCategory,
    byNetwork,
    indexedAt: new Date().toISOString(),
    indexDurationMs: Math.round(endTime - startTime),
    indexerVersion: VERSION,
  };
}

/**
 * Main indexer function
 */
export async function runIndexer(config: IndexerConfig): Promise<IndexOutput> {
  const logger = createLogger(config.verbose);
  const startTime = performance.now();

  logger.info("Starting x402 Bazaar Indexer");
  logger.info(`Facilitator URL: ${config.facilitatorUrl}`);

  logger.info("Fetching resources...");
  const fetchResult = await fetchResources(config);

  logger.info(
    `Fetched ${fetchResult.discoveryResources.length} discovery resources`
  );
  logger.info(`Fetched ${fetchResult.ecosystemServices.length} ecosystem services`);
  logger.info(`Fetched ${fetchResult.partnerMetadata.length} partner metadata`);

  if (fetchResult.errors.length > 0) {
    logger.warn(`Encountered ${fetchResult.errors.length} errors during fetch`);
    for (const error of fetchResult.errors) {
      logger.warn(`  - ${error.source}: ${error.error}`);
    }
  }

  const urlsToCheck: string[] = [];

  for (const resource of fetchResult.discoveryResources) {
    urlsToCheck.push(resource.resource);
  }
  for (const service of fetchResult.ecosystemServices) {
    urlsToCheck.push(service.url);
  }
  for (const partner of fetchResult.partnerMetadata) {
    if (partner.facilitator?.baseUrl) {
      urlsToCheck.push(partner.facilitator.baseUrl);
    }
  }

  const uniqueUrls = [...new Set(urlsToCheck)];
  logger.info(`Total unique URLs to check: ${uniqueUrls.length}`);

  let checkResults = new Map<string, EndpointCheckResult>();

  if (!config.skipHealthChecks && uniqueUrls.length > 0) {
    logger.info("Performing health checks...");
    checkResults = await checkEndpoints(
      uniqueUrls,
      config.timeoutMs,
      config.concurrency,
      config.verbose
    );
  } else if (config.skipHealthChecks) {
    logger.info("Skipping health checks (--skip-health-checks)");
  }

  logger.info("Enriching resources...");
  const enrichedResources: EnrichedResource[] = [];
  const processedUrls = new Set<string>();

  const partnerByUrl = new Map<string, PartnerMetadata>();
  for (const partner of fetchResult.partnerMetadata) {
    partnerByUrl.set(partner.websiteUrl, partner);
    if (partner.facilitator?.baseUrl) {
      partnerByUrl.set(partner.facilitator.baseUrl, partner);
    }
  }

  // Enrich discovery resources (highest priority)
  for (const resource of fetchResult.discoveryResources) {
    const checkResult = checkResults.get(resource.resource);
    const partner = partnerByUrl.get(resource.resource);
    const enriched = enrichDiscoveredResource(resource, checkResult, partner);
    enrichedResources.push(enriched);
    processedUrls.add(resource.resource);
  }

  // Enrich ecosystem services (skip if already in discovery)
  for (const service of fetchResult.ecosystemServices) {
    if (!processedUrls.has(service.url)) {
      const checkResult = checkResults.get(service.url);
      const enriched = enrichEcosystemService(service, checkResult);
      enrichedResources.push(enriched);
      processedUrls.add(service.url);
    }
  }

  // Add facilitators from partner metadata (skip if already processed)
  for (const partner of fetchResult.partnerMetadata) {
    if (
      partner.facilitator?.baseUrl &&
      !processedUrls.has(partner.facilitator.baseUrl)
    ) {
      const checkResult = checkResults.get(partner.facilitator.baseUrl);
      const enriched = enrichPartnerMetadata(partner, checkResult);
      if (enriched) {
        enrichedResources.push(enriched);
        processedUrls.add(partner.facilitator.baseUrl);
      }
    }
  }

  const summary = calculateSummary(enrichedResources, startTime);

  logger.info(`Indexing complete: ${summary.totalResources} resources`);
  logger.info(`  Alive: ${summary.aliveCount}`);
  logger.info(`  Dead: ${summary.deadCount}`);
  if (summary.avgLatencyMs !== undefined) {
    logger.info(`  Avg latency: ${summary.avgLatencyMs}ms`);
  }

  // Persist to SQLite database if enabled
  if (config.persistToDb) {
    logger.info(`Persisting to database: ${config.dbPath}`);
    const db = await getInitializedDb(config.dbPath);
    await persistToDatabase(db, enrichedResources, summary, config.facilitatorUrl, logger);
  }

  return {
    meta: {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      facilitatorUrl: config.facilitatorUrl,
    },
    summary,
    resources: enrichedResources,
  };
}
