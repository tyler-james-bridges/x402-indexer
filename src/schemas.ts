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
  scheme: z.enum(["exact"]).or(z.string()), // Allow other schemes
  network: NetworkSchema.or(z.string()), // Accept CAIP-2 format like "eip155:8453"
  maxAmountRequired: z.string().optional(), // Some endpoints don't have this
  resource: z.string().url().optional(), // Optional in some responses
  description: z.string().optional(),
  mimeType: z.string().optional(),
  outputSchema: z.record(z.unknown()).optional(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int().optional(),
  asset: z.string(),
  extra: z.record(z.unknown()).optional(),
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
  metadata: z.record(z.unknown()).optional(),
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
  scheme: z.string(),
  network: z.string(),
  maxAmountRequired: z.string().optional(), // atomic units
  formattedAmount: z.string().optional(),
  asset: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().optional(),
});

export type PricingInfo = z.infer<typeof PricingInfoSchema>;

export const HealthCheckResultSchema = z.object({
  isAlive: z.boolean(),
  statusCode: z.number().optional(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
  checkedAt: z.string(),
});

export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

export const EnrichedResourceSchema = z.object({
  url: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(["http"]),
  x402Version: z.number(),
  health: HealthCheckResultSchema,
  pricing: z.array(PricingInfoSchema),
  networksSupported: z.array(z.string()),
  accepts: z.array(PaymentRequirementsSchema),
  lastUpdated: z.string(),
  metadata: z.record(z.unknown()).optional(),
  source: z.enum(["discovery_api", "partners_data", "ecosystem", "manual"]),
});

export type EnrichedResource = z.infer<typeof EnrichedResourceSchema>;

// =============================================================================
// Index Output Schema (the final output file structure)
// =============================================================================

export const IndexSummarySchema = z.object({
  totalResources: z.number(),
  aliveCount: z.number(),
  deadCount: z.number(),
  avgLatencyMs: z.number().optional(),
  minLatencyMs: z.number().optional(),
  maxLatencyMs: z.number().optional(),
  byCategory: z.record(z.number()),
  byNetwork: z.record(z.number()),
  indexedAt: z.string(),
  indexDurationMs: z.number(),
  indexerVersion: z.string(),
});

export type IndexSummary = z.infer<typeof IndexSummarySchema>;

export const IndexOutputSchema = z.object({
  meta: z.object({
    version: z.string(),
    generatedAt: z.string(),
    facilitatorUrl: z.string(),
  }),
  summary: IndexSummarySchema,
  resources: z.array(EnrichedResourceSchema),
});

export type IndexOutput = z.infer<typeof IndexOutputSchema>;

// =============================================================================
// Ecosystem Service Schema (scraped from x402.org/ecosystem)
// =============================================================================

export const EcosystemServiceSchema = z.object({
  name: z.string(),
  url: z.string(),
  description: z.string(),
  category: z.string(),
});

export type EcosystemService = z.infer<typeof EcosystemServiceSchema>;

// =============================================================================
// CLI Configuration Schema
// =============================================================================

export const IndexerConfigSchema = z.object({
  facilitatorUrl: z.string().url().default("https://api.cdp.coinbase.com/platform/v2/x402"),
  outputPath: z.string().default("./x402-index.json"),
  timeoutMs: z.number().positive().default(10000),
  concurrency: z.number().positive().default(5),
  includePartnersData: z.boolean().default(false),
  partnersDataPath: z.string().optional(),
  skipHealthChecks: z.boolean().default(false),
  verbose: z.boolean().default(false),
  // Database options
  dbPath: z.string().default("./x402.db"),
  persistToDb: z.boolean().default(true),
  skipJsonOutput: z.boolean().default(false),
  // Ecosystem scraper options
  includeEcosystem: z.boolean().default(true),
  ecosystemUrl: z.string().url().default("https://www.x402.org/ecosystem"),
  // Discovery API options
  skipDiscoveryApi: z.boolean().default(false),
});

export type IndexerConfig = z.infer<typeof IndexerConfigSchema>;
