/**
 * x402 Bazaar Indexer
 *
 * A TypeScript crawler/indexer that enriches x402 ecosystem data
 * from the Bazaar discovery layer.
 *
 * @packageDocumentation
 */

// =============================================================================
// Public API - Schemas and Types
// =============================================================================

// Core output types - what consumers work with
export {
  IndexOutputSchema,
  type IndexOutput,
  EnrichedResourceSchema,
  type EnrichedResource,
  IndexSummarySchema,
  type IndexSummary,
} from "./schemas.js";

// Configuration
export { IndexerConfigSchema, type IndexerConfig } from "./schemas.js";

// Supporting types for working with resources
export {
  HealthCheckResultSchema,
  type HealthCheckResult,
  PricingInfoSchema,
  type PricingInfo,
  NetworkSchema,
  type Network,
} from "./schemas.js";

// =============================================================================
// Public API - Core Functionality
// =============================================================================

export { runIndexer } from "./indexer.js";
export { fetchResources, type FetchResult } from "./fetcher.js";
export {
  checkEndpoint,
  checkEndpoints,
  type EndpointCheckResult,
} from "./health-checker.js";
export { createLogger, type Logger } from "./logger.js";
