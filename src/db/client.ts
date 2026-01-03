/**
 * SQLite Database Client
 *
 * Uses @libsql/client for local SQLite.
 * Default: local file at ./x402.db
 */

import { createClient, type Client } from "@libsql/client";
import { resolve } from "node:path";

let dbClient: Client | null = null;
let currentDbPath: string | null = null;

/**
 * Get or create the database client singleton.
 * Note: dbPath is only used on first call. Subsequent calls with different
 * paths will throw to prevent silent bugs.
 */
export function getDatabase(dbPath = "./x402.db"): Client {
  const resolvedPath = resolve(dbPath);

  if (dbClient) {
    if (currentDbPath !== resolvedPath) {
      throw new Error(
        `Database already initialized with path "${currentDbPath}", ` +
          `cannot reinitialize with "${resolvedPath}". ` +
          `Call closeDatabase() first if you need to switch databases.`
      );
    }
    return dbClient;
  }

  dbClient = createClient({
    url: `file:${resolvedPath}`,
  });
  currentDbPath = resolvedPath;

  return dbClient;
}

/**
 * Initialize database pragmas (call after creating client, before schema init)
 */
export async function initializePragmas(db: Client): Promise<void> {
  // Enable foreign key constraint enforcement
  await db.execute("PRAGMA foreign_keys = ON");
  // Enable WAL mode for better concurrent read/write performance
  await db.execute("PRAGMA journal_mode = WAL");
}

/**
 * Close the database connection (sync for use in exit handlers)
 */
export function closeDatabase(): void {
  if (dbClient) {
    dbClient.close();
    dbClient = null;
    currentDbPath = null;
  }
}
