/**
 * Bazaar API Fetcher
 *
 * Fetches x402-enabled resources from the discovery API and optional local
 * partner metadata files.
 */

import { readdir, readFile } from "node:fs/promises";
import { validateUrl } from "./utils/url-validator.js";
import { join } from "node:path";
import {
  type DiscoveredResource,
  ListDiscoveryResourcesResponseSchema,
  type PartnerMetadata,
  PartnerMetadataSchema,
  type IndexerConfig,
} from "./schemas.js";
import { createLogger, type Logger } from "./logger.js";

/**
 * Result of fetching discovery resources
 */
export interface FetchResult {
  /** Resources from the discovery API */
  discoveryResources: DiscoveredResource[];
  /** Partner metadata from local files */
  partnerMetadata: PartnerMetadata[];
  /** Errors encountered during fetching */
  errors: Array<{ source: string; error: string }>;
}

/**
 * Fetches resources from the x402 discovery API
 */
async function fetchDiscoveryResources(
  facilitatorUrl: string,
  timeoutMs: number,
  logger: Logger
): Promise<{ resources: DiscoveredResource[]; error?: string }> {
  const url = `${facilitatorUrl}/discovery/resources`;
  logger.info(`Fetching discovery resources from ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.warn(
        `Discovery API returned ${response.status}: ${response.statusText}`
      );
      return {
        resources: [],
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data: unknown = await response.json();
    const parsed = ListDiscoveryResourcesResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.warn(`Failed to parse discovery response: ${parsed.error.message}`);
      return {
        resources: [],
        error: `Schema validation failed: ${parsed.error.message}`,
      };
    }

    logger.info(
      `Fetched ${parsed.data.items.length} resources from discovery API`
    );
    return { resources: parsed.data.items };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown fetch error";
    logger.error(`Failed to fetch discovery resources: ${message}`);
    return { resources: [], error: message };
  }
}

/**
 * Loads partner metadata from local JSON files
 */
async function loadPartnersData(
  partnersDataPath: string,
  logger: Logger
): Promise<{ metadata: PartnerMetadata[]; errors: Array<{ source: string; error: string }> }> {
  const metadata: PartnerMetadata[] = [];
  const errors: Array<{ source: string; error: string }> = [];

  logger.info(`Loading partners data from ${partnersDataPath}`);

  try {
    const entries = await readdir(partnersDataPath, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    for (const dir of directories) {
      const metadataPath = join(partnersDataPath, dir.name, "metadata.json");

      try {
        const content = await readFile(metadataPath, "utf-8");
        const data: unknown = JSON.parse(content);
        const parsed = PartnerMetadataSchema.safeParse({
          ...data as object,
          slug: dir.name,
        });

        if (parsed.success) {
          metadata.push(parsed.data);
          logger.debug(`Loaded partner metadata: ${parsed.data.name}`);
        } else {
          errors.push({
            source: metadataPath,
            error: `Schema validation failed: ${parsed.error.message}`,
          });
          logger.warn(`Invalid metadata in ${metadataPath}: ${parsed.error.message}`);
        }
      } catch (error) {
        // File might not exist, which is fine
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          errors.push({ source: metadataPath, error: message });
          logger.warn(`Failed to load ${metadataPath}: ${message}`);
        }
      }
    }

    logger.info(`Loaded ${metadata.length} partner metadata files`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push({ source: partnersDataPath, error: message });
    logger.error(`Failed to read partners data directory: ${message}`);
  }

  return { metadata, errors };
}

/**
 * Main fetcher function - retrieves all x402 resources
 */
export async function fetchResources(
  config: IndexerConfig
): Promise<FetchResult> {
  const logger = createLogger(config.verbose);
  const result: FetchResult = {
    discoveryResources: [],
    partnerMetadata: [],
    errors: [],
  };

  // Fetch from discovery API
  const discoveryResult = await fetchDiscoveryResources(
    config.facilitatorUrl,
    config.timeoutMs,
    logger
  );

  result.discoveryResources = discoveryResult.resources;
  if (discoveryResult.error) {
    result.errors.push({
      source: config.facilitatorUrl,
      error: discoveryResult.error,
    });
  }

  // Load local partners data if configured
  if (config.includePartnersData && config.partnersDataPath) {
    const partnersResult = await loadPartnersData(
      config.partnersDataPath,
      logger
    );
    result.partnerMetadata = partnersResult.metadata;
    result.errors.push(...partnersResult.errors);
  }

  return result;
}

/**
 * Fetches a single resource's payment requirements via a 402 response
 *
 * This makes a request to the resource URL and expects a 402 response
 * with X-Payment header containing payment requirements.
 */
export async function fetchPaymentRequirements(
  resourceUrl: string,
  timeoutMs: number,
  _logger: Logger
): Promise<{
  requirements: unknown | null;
  statusCode: number;
  error?: string;
}> {
  // Validate URL before fetching (security: prevent SSRF)
  const urlCheck = validateUrl(resourceUrl);
  if (!urlCheck.valid) {
    return { requirements: null, statusCode: 0, error: urlCheck.error ?? "Invalid URL" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(resourceUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check for X-Payment header (payment requirements)
    const xPaymentHeader = response.headers.get("X-Payment");

    if (response.status === 402 && xPaymentHeader) {
      try {
        const requirements = JSON.parse(
          Buffer.from(xPaymentHeader, "base64").toString("utf-8")
        );
        return { requirements, statusCode: response.status };
      } catch {
        // Try parsing as plain JSON
        try {
          const requirements = JSON.parse(xPaymentHeader);
          return { requirements, statusCode: response.status };
        } catch {
          return {
            requirements: null,
            statusCode: response.status,
            error: "Failed to parse X-Payment header",
          };
        }
      }
    }

    return { requirements: null, statusCode: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { requirements: null, statusCode: 0, error: message };
  }
}
