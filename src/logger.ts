/**
 * Simple logger utility for the x402 indexer
 */

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Creates a logger instance
 */
export function createLogger(verbose: boolean): Logger {
  const timestamp = (): string => new Date().toISOString();

  return {
    debug(message: string): void {
      if (verbose) {
        console.log(`[${timestamp()}] DEBUG: ${message}`);
      }
    },
    info(message: string): void {
      console.log(`[${timestamp()}] INFO: ${message}`);
    },
    warn(message: string): void {
      console.warn(`[${timestamp()}] WARN: ${message}`);
    },
    error(message: string): void {
      console.error(`[${timestamp()}] ERROR: ${message}`);
    },
  };
}
