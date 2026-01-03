export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const timestamp = (): string => new Date().toISOString();

export function createLogger(verbose: boolean): Logger {
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
