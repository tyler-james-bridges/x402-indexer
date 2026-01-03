/**
 * Zod schemas for x402 Bazaar Indexer
 *
 * These schemas define the structure of discovery resources from the x402 Bazaar
 * and the enriched data we generate after crawling and health checking.
 */

import { z } from "zod";

// =============================================================================
// Network Schema (mirrors x402/types/shared/network.ts)
// =============================================================================

export const NetworkSchema = z.enum([
  "abstract",
  "abstract-testnet",
  "base-sepolia",
  "base",
  "avalanche-fuji",
  "avalanche",
  "iotex",
  "solana-devnet",
  "solana",
  "sei",
  "sei-testnet",
  "polygon",
  "polygon-amoy",
  "peaq",
  "story",
  "educhain",
  "skale-base-sepolia",
]);

export type Network = z.infer<typeof NetworkSchema>;

// =============================================================================
// Payment Requirements Schema (from x402 spec)
// =============================================================================

export const PaymentRequirementsSchema = z.object({
  scheme: z.enum(["exact"]),
  network: NetworkSchema,
  maxAmountRequired: z.string(),
  resource: z.string().url(),
  description: z.string(),
  mimeType: z.string(),
  outputSchema: z.record(z.any()).optional(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int(),
  asset: z.string(),
  extra: z.record(z.any()).optional(),
});

export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

// =============================================================================
// Discovery Resource Schema (from x402 discovery API)
// =============================================================================

export const DiscoveredResourceSchema = z.object({
  resource: z.string(),
  type: z.enum(["http"]),
  x402Version: z.number(),
  accepts: z.array(PaymentRequirementsSchema),
  lastUpdated: z.union([z.date(), z.string()]),
  metadata: z.record(z.any()).optional(),
});

export type DiscoveredResource = z.infer<typeof DiscoveredResourceSchema>;

// =============================================================================
// Discovery API Response Schema
// =============================================================================

export const ListDiscoveryResourcesResponseSchema = z.object({
  x402Version: z.number(),
  items: z.array(DiscoveredResourceSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  }),
});

export type ListDiscoveryResourcesResponse = z.infer<
  typeof ListDiscoveryResourcesResponseSchema
>;

// =============================================================================
// Partner Metadata Schema (from ecosystem partners-data)
// =============================================================================

export const FacilitatorInfoSchema = z.object({
  baseUrl: z.string().url(),
  networks: z.array(z.string()),
  schemes: z.array(z.string()),
  assets: z.array(z.string()),
  supports: z.object({
    verify: z.boolean(),
    settle: z.boolean(),
    supported: z.boolean(),
    list: z.boolean(),
  }),
});

export type FacilitatorInfo = z.infer<typeof FacilitatorInfoSchema>;

export const PartnerMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  logoUrl: z.string(),
  websiteUrl: z.string().url(),
  category: z.string(),
  slug: z.string().optional(),
  facilitator: FacilitatorInfoSchema.optional(),
});

export type PartnerMetadata = z.infer<typeof PartnerMetadataSchema>;

// =============================================================================
// Enriched Resource Schema (our indexed/enriched data)
// =============================================================================

export const PricingInfoSchema = z.object({
  /** Payment scheme (e.g., "exact") */
  scheme: z.string(),
  /** Network identifier (e.g., "base", "solana") */
  network: z.string(),
  /** Maximum amount required in atomic units */
  maxAmountRequired: z.string(),
  /** Human-readable formatted amount (e.g., "0.01 USDC") */
  formattedAmount: z.string().optional(),
  /** Asset address or identifier */
  asset: z.string(),
  /** Payment recipient address */
  payTo: z.string(),
  /** Maximum timeout in seconds */
  maxTimeoutSeconds: z.number(),
});

export type PricingInfo = z.infer<typeof PricingInfoSchema>;

export const HealthCheckResultSchema = z.object({
  /** Whether the endpoint is reachable */
  isAlive: z.boolean(),
  /** HTTP status code returned */
  statusCode: z.number().optional(),
  /** Response latency in milliseconds */
  latencyMs: z.number().optional(),
  /** Error message if health check failed */
  error: z.string().optional(),
  /** Timestamp of the health check */
  checkedAt: z.string(),
});

export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

export const EnrichedResourceSchema = z.object({
  /** Resource URL */
  url: z.string(),
  /** Resource name (from metadata or derived) */
  name: z.string().optional(),
  /** Resource description */
  description: z.string().optional(),
  /** Category (e.g., "Services/Endpoints", "Facilitators") */
  category: z.string().optional(),
  /** Resource type (currently only "http") */
  type: z.enum(["http"]),
  /** x402 protocol version */
  x402Version: z.number(),
  /** Health check results */
  health: HealthCheckResultSchema,
  /** Parsed pricing information from payment requirements */
  pricing: z.array(PricingInfoSchema),
  /** Networks supported by this resource */
  networksSupported: z.array(z.string()),
  /** Original payment requirements from discovery */
  accepts: z.array(PaymentRequirementsSchema),
  /** Last updated timestamp from discovery */
  lastUpdated: z.string(),
  /** Additional metadata */
  metadata: z.record(z.any()).optional(),
  /** Source of this resource data */
  source: z.enum(["discovery_api", "partners_data", "manual"]),
});

export type EnrichedResource = z.infer<typeof EnrichedResourceSchema>;

// =============================================================================
// Index Output Schema (the final output file structure)
// =============================================================================

export const IndexSummarySchema = z.object({
  /** Total number of resources indexed */
  totalResources: z.number(),
  /** Number of alive/reachable resources */
  aliveCount: z.number(),
  /** Number of unreachable resources */
  deadCount: z.number(),
  /** Average latency in milliseconds for alive resources */
  avgLatencyMs: z.number().optional(),
  /** Minimum latency in milliseconds */
  minLatencyMs: z.number().optional(),
  /** Maximum latency in milliseconds */
  maxLatencyMs: z.number().optional(),
  /** Resources grouped by category */
  byCategory: z.record(z.number()),
  /** Resources grouped by network */
  byNetwork: z.record(z.number()),
  /** Indexing started at */
  indexedAt: z.string(),
  /** Indexing duration in milliseconds */
  indexDurationMs: z.number(),
  /** Version of the indexer */
  indexerVersion: z.string(),
});

export type IndexSummary = z.infer<typeof IndexSummarySchema>;

export const IndexOutputSchema = z.object({
  /** Metadata about the index */
  meta: z.object({
    version: z.string(),
    generatedAt: z.string(),
    facilitatorUrl: z.string(),
  }),
  /** Summary statistics */
  summary: IndexSummarySchema,
  /** All enriched resources */
  resources: z.array(EnrichedResourceSchema),
});

export type IndexOutput = z.infer<typeof IndexOutputSchema>;

// =============================================================================
// CLI Configuration Schema
// =============================================================================

export const IndexerConfigSchema = z.object({
  /** Base URL of the facilitator discovery API */
  facilitatorUrl: z.string().url().default("https://x402.org/facilitator"),
  /** Output file path */
  outputPath: z.string().default("./x402-index.json"),
  /** Request timeout in milliseconds */
  timeoutMs: z.number().positive().default(10000),
  /** Number of concurrent health check requests */
  concurrency: z.number().positive().default(5),
  /** Whether to include partners data from local files */
  includePartnersData: z.boolean().default(false),
  /** Path to partners data directory (if includePartnersData is true) */
  partnersDataPath: z.string().optional(),
  /** Whether to skip health checks */
  skipHealthChecks: z.boolean().default(false),
  /** Verbose logging */
  verbose: z.boolean().default(false),
});

export type IndexerConfig = z.infer<typeof IndexerConfigSchema>;
