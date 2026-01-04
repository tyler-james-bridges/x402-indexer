/**
 * Health Checker
 *
 * Performs health checks on x402 endpoints to measure latency,
 * verify availability, and parse payment requirement headers.
 *
 * Optimized to extract both health and payment info from a single HTTP request.
 */

import { validateUrl } from "./utils/url-validator.js";
import { formatAmount } from "./utils/formatting.js";
import { fetchWithRetry } from "./utils/fetch-with-timeout.js";
import {
  type HealthCheckResult,
  type PricingInfo,
  type PaymentRequirements,
  PaymentRequirementsSchema,
} from "./schemas.js";
import { createLogger, type Logger } from "./logger.js";

/**
 * Result of a full endpoint check including health and pricing
 */
export interface EndpointCheckResult {
  health: HealthCheckResult;
  pricing: PricingInfo[];
  rawPaymentRequirements: PaymentRequirements[];
}

/**
 * Performs a single HTTP request and extracts both health and payment info.
 * This is more efficient than separate health check + payment fetch requests.
 */
async function checkEndpointSingle(
  url: string,
  timeoutMs: number,
  logger: Logger
): Promise<EndpointCheckResult> {
  const checkedAt = new Date().toISOString();
  const startTime = performance.now();

  try {
    // Single GET request - extracts both health and payment info
    const response = await fetchWithRetry(url, {
      timeoutMs,
      method: "GET",
      headers: { Accept: "application/json" },
      retries: 2,
      retryDelayMs: 500,
    });

    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);

    // Consider both 2xx and 402 as "alive" - 402 is expected for x402 endpoints
    const isAlive = response.ok || response.status === 402;

    logger.debug(
      `Health check ${url}: ${response.status} (${latencyMs}ms) - ${isAlive ? "alive" : "dead"}`
    );

    const health: HealthCheckResult = {
      isAlive,
      statusCode: response.status,
      latencyMs,
      checkedAt,
    };

    // Extract payment info from 402 responses
    let pricing: PricingInfo[] = [];
    let rawPaymentRequirements: PaymentRequirements[] = [];

    if (response.status === 402) {
      const paymentInfo = await extractPaymentInfoFromResponse(response, logger);
      pricing = paymentInfo.pricing;
      rawPaymentRequirements = paymentInfo.requirements;
    }

    return { health, pricing, rawPaymentRequirements };
  } catch (error) {
    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.debug(`Health check ${url}: FAILED - ${errorMessage}`);

    return {
      health: {
        isAlive: false,
        latencyMs,
        error: errorMessage,
        checkedAt,
      },
      pricing: [],
      rawPaymentRequirements: [],
    };
  }
}

/**
 * Extracts payment requirements from an already-fetched 402 response
 */
async function extractPaymentInfoFromResponse(
  response: Response,
  logger: Logger
): Promise<{ pricing: PricingInfo[]; requirements: PaymentRequirements[] }> {
  const pricing: PricingInfo[] = [];
  const requirements: PaymentRequirements[] = [];

  // Try to get payment requirements from X-Payment header first
  const xPaymentHeader = response.headers.get("X-Payment");
  if (xPaymentHeader) {
    const parsed = parseXPaymentHeader(xPaymentHeader, logger);
    if (parsed.length > 0) {
      requirements.push(...parsed);
      pricing.push(...parsed.map(convertToPricingInfo));
      return { pricing, requirements };
    }
  }

  // Try to get payment requirements from response body
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      // Check for x402Response format
      const x402Body = body as { accepts?: unknown[] };
      if (Array.isArray(x402Body.accepts)) {
        for (const accept of x402Body.accepts) {
          const parsed = PaymentRequirementsSchema.safeParse(accept);
          if (parsed.success) {
            requirements.push(parsed.data);
            pricing.push(convertToPricingInfo(parsed.data));
          }
        }
      }
    }
  } catch {
    // Expected: 402 responses may not have JSON bodies
    logger.debug("Response body is not JSON (expected for some endpoints)");
  }

  return { pricing, requirements };
}

/**
 * Extracts valid payment requirements from parsed JSON data
 */
function extractPaymentRequirements(data: unknown): PaymentRequirements[] {
  const results: PaymentRequirements[] = [];
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    const parsed = PaymentRequirementsSchema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data);
    }
  }
  return results;
}

/**
 * Parses the X-Payment header which can be base64 or JSON encoded
 */
function parseXPaymentHeader(
  header: string,
  logger: Logger
): PaymentRequirements[] {
  // Try base64 decoding first
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const results = extractPaymentRequirements(JSON.parse(decoded));
    if (results.length > 0) return results;
  } catch {
    // Not base64 encoded, try plain JSON
  }

  // Try plain JSON
  try {
    return extractPaymentRequirements(JSON.parse(header));
  } catch {
    logger.debug("Failed to parse X-Payment header as JSON");
  }

  return [];
}

/**
 * Converts PaymentRequirements to PricingInfo
 */
function convertToPricingInfo(req: PaymentRequirements): PricingInfo {
  return {
    scheme: req.scheme,
    network: req.network,
    maxAmountRequired: req.maxAmountRequired,
    formattedAmount: formatAmount(req.maxAmountRequired, req.asset),
    asset: req.asset,
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
  };
}

/**
 * Performs a full check on an endpoint (health + payment info in single request)
 */
export async function checkEndpoint(
  url: string,
  timeoutMs: number,
  verbose: boolean
): Promise<EndpointCheckResult> {
  const logger = createLogger(verbose);

  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) {
    logger.debug(`Skipping invalid URL ${url}: ${urlCheck.error}`);
    return {
      health: {
        isAlive: false,
        error: urlCheck.error,
        checkedAt: new Date().toISOString(),
      },
      pricing: [],
      rawPaymentRequirements: [],
    };
  }

  // Single request extracts both health and payment info
  return checkEndpointSingle(url, timeoutMs, logger);
}

/**
 * Checks multiple endpoints with concurrency control
 */
export async function checkEndpoints(
  urls: string[],
  timeoutMs: number,
  concurrency: number,
  verbose: boolean
): Promise<Map<string, EndpointCheckResult>> {
  const logger = createLogger(verbose);
  const results = new Map<string, EndpointCheckResult>();

  logger.info(`Checking ${urls.length} endpoints with concurrency ${concurrency}`);

  // Process URLs in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchPromises = batch.map(async (url) => {
      const result = await checkEndpoint(url, timeoutMs, verbose);
      return { url, result };
    });

    const batchResults = await Promise.all(batchPromises);
    for (const { url, result } of batchResults) {
      results.set(url, result);
    }

    const progress = Math.min(i + concurrency, urls.length);
    logger.info(`Progress: ${progress}/${urls.length} endpoints checked`);
  }

  return results;
}
