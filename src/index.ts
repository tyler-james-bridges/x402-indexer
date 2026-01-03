/**
 * x402 Bazaar Indexer
 *
 * A TypeScript crawler/indexer that enriches x402 ecosystem data
 * from the Bazaar discovery layer.
 *
 * @packageDocumentation
 */

// Re-export all schemas and types
export * from "./schemas.js";

// Re-export core functionality
export { runIndexer } from "./indexer.js";
export { fetchResources, type FetchResult } from "./fetcher.js";
export {
  checkEndpoint,
  checkEndpoints,
  type EndpointCheckResult,
} from "./health-checker.js";
export { createLogger, type Logger } from "./logger.js";
