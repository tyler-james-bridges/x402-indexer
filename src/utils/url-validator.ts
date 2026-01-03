/**
 * URL Validator
 *
 * Validates URLs for safe fetching, preventing SSRF attacks by blocking:
 * - Non-HTTPS protocols
 * - Localhost and internal hostnames
 * - Private IPv4 and IPv6 ranges
 * - Cloud metadata endpoints
 */

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Blocked hostnames that should never be accessed
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::]",
  "[::1]",
  // Common cloud metadata endpoints
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
]);

/**
 * Checks if an IPv4 address is in a private/reserved range
 */
function isPrivateIPv4(hostname: string): boolean {
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4Match) return false;

  const [, a, b] = ipv4Match.map(Number);

  // 10.0.0.0/8 - Private
  if (a === 10) return true;

  // 127.0.0.0/8 - Loopback
  if (a === 127) return true;

  // 172.16.0.0/12 - Private
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 - Private
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 - Link-local (includes cloud metadata)
  if (a === 169 && b === 254) return true;

  // 0.0.0.0/8 - Current network
  if (a === 0) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private/reserved range
 */
function isPrivateIPv6(hostname: string): boolean {
  // Remove brackets if present (e.g., [::1])
  const cleanHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // Check for common loopback representations
  if (cleanHostname === "::1" || cleanHostname === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // Check for unspecified address
  if (cleanHostname === "::" || cleanHostname === "0:0:0:0:0:0:0:0") {
    return true;
  }

  // fc00::/7 - Unique Local Addresses (ULA)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleanHostname)) {
    return true;
  }

  // fe80::/10 - Link-local addresses
  if (/^fe[89ab][0-9a-f]:/i.test(cleanHostname)) {
    return true;
  }

  // ::ffff:0:0/96 - IPv4-mapped IPv6 addresses
  // These could be used to bypass IPv4 checks
  // Note: URL API normalizes these to hex format (e.g., ::ffff:a00:1 for 10.0.0.1)
  if (cleanHostname.startsWith("::ffff:")) {
    const ipv4Part = cleanHostname.slice(7);

    // Try direct dotted-decimal format first
    if (isPrivateIPv4(ipv4Part)) {
      return true;
    }

    // Handle hex format (e.g., "a00:1" for 10.0.0.1)
    // Format is either "xxxx:xxxx" or "xxxx:x" where x is hex
    const hexMatch = ipv4Part.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch && hexMatch[1] && hexMatch[2]) {
      const high = parseInt(hexMatch[1], 16);
      const low = parseInt(hexMatch[2], 16);
      // Convert to IPv4 octets: high = (a << 8) | b, low = (c << 8) | d
      const a = (high >> 8) & 0xff;
      const b = high & 0xff;
      const c = (low >> 8) & 0xff;
      const d = low & 0xff;
      const ipv4 = `${a}.${b}.${c}.${d}`;
      if (isPrivateIPv4(ipv4)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates that a URL is safe to fetch (https:// only, no internal IPs)
 *
 * @param url - The URL to validate
 * @returns Validation result with error message if invalid
 */
export function validateUrl(url: string): UrlValidationResult {
  try {
    const parsed = new URL(url);

    // Only allow https://
    if (parsed.protocol !== "https:") {
      return {
        valid: false,
        error: `Invalid protocol: ${parsed.protocol} (only https:// allowed)`,
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check blocked hostnames
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return { valid: false, error: `Blocked hostname: ${hostname}` };
    }

    // Check private IPv4 ranges
    if (isPrivateIPv4(hostname)) {
      return { valid: false, error: `Blocked private IP: ${hostname}` };
    }

    // Check private IPv6 ranges
    if (isPrivateIPv6(hostname)) {
      return { valid: false, error: `Blocked private IPv6: ${hostname}` };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}
