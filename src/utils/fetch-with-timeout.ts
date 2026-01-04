/**
 * Fetch with Timeout and Retry Utility
 *
 * Provides wrappers around fetch that handle:
 * - Automatic timeout via AbortController
 * - Retry with exponential backoff for transient failures
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs: number;
}

export interface FetchWithRetryOptions extends FetchWithTimeoutOptions {
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Determines if an error is retryable (transient network issues)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on network errors, timeouts, and connection issues
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("abort") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("socket")
    );
  }
  return false;
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic timeout handling.
 * Returns the Response on success, or throws on timeout/error.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions
): Promise<Response> {
  const { timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch with automatic timeout and retry with exponential backoff.
 * Only retries on transient network errors, not on HTTP error responses.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions
): Promise<Response> {
  const { retries = 2, retryDelayMs = 500, ...fetchOptions } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, fetchOptions);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if it's not a retryable error or we're out of retries
      if (!isRetryableError(error) || attempt === retries) {
        throw lastError;
      }

      // Exponential backoff: delay * 2^attempt
      const delay = retryDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError ?? new Error("Fetch failed");
}
