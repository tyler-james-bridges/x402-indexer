/**
 * Fetch with Timeout Utility
 *
 * Provides a wrapper around fetch that automatically handles
 * timeout via AbortController.
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs: number;
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
