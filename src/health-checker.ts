/**
 * Health Checker
 *
 * Performs health checks on x402 endpoints to measure latency,
 * verify availability, and parse payment requirement headers.
 */

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
 * Performs a health check on a single endpoint
 */
async function checkEndpointHealth(
  url: string,
  timeoutMs: number,
  logger: Logger
): Promise<HealthCheckResult> {
  const checkedAt = new Date().toISOString();
  const startTime = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Use HEAD request first for efficiency, fall back to GET if needed
    let response: Response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });
    } catch {
      // Some servers don't support HEAD, try GET
      response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);

    // Consider both 2xx and 402 as "alive" - 402 is expected for x402 endpoints
    const isAlive = response.ok || response.status === 402;

    logger.debug(
      `Health check ${url}: ${response.status} (${latencyMs}ms) - ${isAlive ? "alive" : "dead"}`
    );

    return {
      isAlive,
      statusCode: response.status,
      latencyMs,
      checkedAt,
    };
  } catch (error) {
    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.debug(`Health check ${url}: FAILED - ${errorMessage}`);

    return {
      isAlive: false,
      latencyMs,
      error: errorMessage,
      checkedAt,
    };
  }
}

/**
 * Fetches and parses payment requirements from an endpoint's 402 response
 */
async function fetchPaymentInfo(
  url: string,
  timeoutMs: number,
  logger: Logger
): Promise<{ pricing: PricingInfo[]; requirements: PaymentRequirements[] }> {
  const pricing: PricingInfo[] = [];
  const requirements: PaymentRequirements[] = [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status !== 402) {
      return { pricing, requirements };
    }

    // Try to get payment requirements from X-Payment header
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
      // Response body is not JSON, that's fine
    }

    return { pricing, requirements };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.debug(`Failed to fetch payment info from ${url}: ${message}`);
    return { pricing, requirements };
  }
}

/**
 * Parses the X-Payment header which can be base64 or JSON encoded
 */
function parseXPaymentHeader(
  header: string,
  logger: Logger
): PaymentRequirements[] {
  const results: PaymentRequirements[] = [];

  // Try base64 decoding first
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const data: unknown = JSON.parse(decoded);

    if (Array.isArray(data)) {
      for (const item of data) {
        const parsed = PaymentRequirementsSchema.safeParse(item);
        if (parsed.success) {
          results.push(parsed.data);
        }
      }
    } else {
      const parsed = PaymentRequirementsSchema.safeParse(data);
      if (parsed.success) {
        results.push(parsed.data);
      }
    }

    if (results.length > 0) {
      return results;
    }
  } catch {
    // Not base64 encoded, try plain JSON
  }

  // Try plain JSON
  try {
    const data: unknown = JSON.parse(header);

    if (Array.isArray(data)) {
      for (const item of data) {
        const parsed = PaymentRequirementsSchema.safeParse(item);
        if (parsed.success) {
          results.push(parsed.data);
        }
      }
    } else {
      const parsed = PaymentRequirementsSchema.safeParse(data);
      if (parsed.success) {
        results.push(parsed.data);
      }
    }
  } catch {
    logger.debug("Failed to parse X-Payment header as JSON");
  }

  return results;
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
 * Formats an atomic amount into a human-readable string
 *
 * This is a simplified formatter that assumes USDC (6 decimals) for common assets.
 * In production, you'd want to look up the actual decimals for each asset.
 */
function formatAmount(atomicAmount: string, asset: string): string {
  try {
    const amount = BigInt(atomicAmount);
    // Assume 6 decimals for USDC and similar stablecoins
    const decimals = 6;
    const divisor = BigInt(10 ** decimals);
    const wholePart = amount / divisor;
    const fractionalPart = amount % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");

    // Truncate trailing zeros in fractional part
    const trimmedFractional = fractionalStr.replace(/0+$/, "") || "0";

    // Get asset symbol (simplified - just use last part of address or known symbols)
    const symbol = getAssetSymbol(asset);

    if (trimmedFractional === "0") {
      return `${wholePart} ${symbol}`;
    }
    return `${wholePart}.${trimmedFractional} ${symbol}`;
  } catch {
    return `${atomicAmount} (raw)`;
  }
}

/**
 * Gets a human-readable symbol for an asset
 */
function getAssetSymbol(asset: string): string {
  // Known USDC addresses on various networks
  const usdcAddresses = new Set([
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base mainnet
    "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Base Sepolia
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Solana
  ]);

  const lowerAsset = asset.toLowerCase();
  if (usdcAddresses.has(lowerAsset) || asset.includes("USDC")) {
    return "USDC";
  }

  // Return shortened address if unknown
  if (asset.startsWith("0x") && asset.length > 10) {
    return `${asset.slice(0, 6)}...${asset.slice(-4)}`;
  }

  return asset;
}

/**
 * Performs a full check on an endpoint (health + payment info)
 */
export async function checkEndpoint(
  url: string,
  timeoutMs: number,
  verbose: boolean
): Promise<EndpointCheckResult> {
  const logger = createLogger(verbose);

  // Perform health check
  const health = await checkEndpointHealth(url, timeoutMs, logger);

  // If endpoint is alive, try to fetch payment info
  let pricing: PricingInfo[] = [];
  let rawPaymentRequirements: PaymentRequirements[] = [];

  if (health.isAlive) {
    const paymentInfo = await fetchPaymentInfo(url, timeoutMs, logger);
    pricing = paymentInfo.pricing;
    rawPaymentRequirements = paymentInfo.requirements;
  }

  return {
    health,
    pricing,
    rawPaymentRequirements,
  };
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
