/**
 * Database Module Exports
 */

import { getDatabase, initializePragmas } from "./client.js";
import { initializeSchema } from "./schema.js";
import type { Client } from "@libsql/client";

export { getDatabase, closeDatabase } from "./client.js";

export { initializeSchema } from "./schema.js";

/**
 * Get an initialized database connection (pragmas + schema)
 * Use this instead of calling getDatabase/initializePragmas/initializeSchema separately
 */
export async function getInitializedDb(dbPath = "./x402.db"): Promise<Client> {
  const db = getDatabase(dbPath);
  await initializePragmas(db);
  await initializeSchema(db);
  return db;
}

export {
  upsertResource,
  getResources,
  getResourceByUrl,
  getHealthHistory,
  startIndexRun,
  completeIndexRun,
  failIndexRun,
  getIndexRuns,
  getStats,
  cleanupOldHealthChecks,
  cleanupStaleResources,
} from "./repository.js";

export type { ResourceFilter, ResourceWithHealth } from "./repository.js";
