/**
 * Database Schema and Migrations
 *
 * Defines the SQLite schema for persisting x402 indexed data.
 */

import type { Client } from "@libsql/client";

/**
 * Current schema version - increment when adding migrations
 */
export const SCHEMA_VERSION = 2;

/**
 * Initialize database schema
 */
export async function initializeSchema(db: Client): Promise<void> {
  // Create schema version table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Check current version
  const result = await db.execute(
    "SELECT MAX(version) as version FROM schema_version"
  );
  const currentVersion = (result.rows[0]?.["version"] as number) ?? 0;

  // Run migrations
  if (currentVersion < 1) {
    await migrateV1(db);
  }

  if (currentVersion < 2) {
    await migrateV2(db);
  }
}

/**
 * Migration V1: Initial schema
 */
async function migrateV1(db: Client): Promise<void> {
  const tx = await db.transaction("write");

  try {
    // Resources table - core indexed resources
    await tx.execute(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      name TEXT,
      description TEXT,
      category TEXT,
      type TEXT NOT NULL DEFAULT 'http',
      x402_version INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL CHECK (source IN ('discovery_api', 'partners_data', 'manual')),
      networks_supported TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_updated TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    // Payment requirements table
    await tx.execute(`
    CREATE TABLE IF NOT EXISTS payment_requirements (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      scheme TEXT NOT NULL,
      network TEXT NOT NULL,
      asset TEXT NOT NULL,
      max_amount_required TEXT NOT NULL,
      formatted_amount TEXT,
      pay_to TEXT NOT NULL,
      max_timeout_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (resource_id, network, asset)
    )
  `);

    // Health checks table - historical health data
    await tx.execute(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      is_alive INTEGER NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      error TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    // Current health status (denormalized for fast queries)
    await tx.execute(`
    CREATE TABLE IF NOT EXISTS resource_health (
      resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
      is_alive INTEGER NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      error TEXT,
      checked_at TEXT NOT NULL,
      uptime_7d REAL,
      avg_latency_7d REAL,
      check_count_7d INTEGER DEFAULT 0
    )
  `);

    // Index run history
    await tx.execute(`
    CREATE TABLE IF NOT EXISTS index_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      total_resources INTEGER,
      alive_count INTEGER,
      dead_count INTEGER,
      avg_latency_ms INTEGER,
      duration_ms INTEGER,
      facilitator_url TEXT,
      indexer_version TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
      error TEXT
    )
  `);

    // Create indexes for common queries
    // Note: idx_resources_url not needed - UNIQUE constraint auto-creates index
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_resources_source ON resources(source)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_health_checks_resource ON health_checks(resource_id)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_health_checks_time ON health_checks(checked_at DESC)
    `);
    // Composite index for 7-day aggregation query
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_health_checks_resource_time ON health_checks(resource_id, checked_at DESC)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_payment_requirements_resource ON payment_requirements(resource_id)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_payment_requirements_network ON payment_requirements(network)
    `);

    // Record migration
    await tx.execute({
      sql: "INSERT INTO schema_version (version) VALUES (?)",
      args: [1],
    });

    await tx.commit();
    console.log("Database schema v1 initialized");
  } finally {
    tx.close();
  }
}

/**
 * Migration V2: Add 'ecosystem' to source CHECK constraint
 */
async function migrateV2(db: Client): Promise<void> {
  const tx = await db.transaction("write");

  try {
    // SQLite requires recreating table to modify CHECK constraint
    // 1. Create new table with updated constraint
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS resources_new (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        name TEXT,
        description TEXT,
        category TEXT,
        type TEXT NOT NULL DEFAULT 'http',
        x402_version INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL CHECK (source IN ('discovery_api', 'partners_data', 'manual', 'ecosystem')),
        networks_supported TEXT NOT NULL DEFAULT '[]',
        metadata TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_updated TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // 2. Copy existing data
    await tx.execute(`
      INSERT OR IGNORE INTO resources_new
      SELECT * FROM resources
    `);

    // 3. Drop old table
    await tx.execute(`DROP TABLE resources`);

    // 4. Rename new table
    await tx.execute(`ALTER TABLE resources_new RENAME TO resources`);

    // 5. Recreate indexes
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category)
    `);
    await tx.execute(`
      CREATE INDEX IF NOT EXISTS idx_resources_source ON resources(source)
    `);

    // Record migration
    await tx.execute({
      sql: "INSERT INTO schema_version (version) VALUES (?)",
      args: [2],
    });

    await tx.commit();
    console.log("Database schema v2 applied: added 'ecosystem' source");
  } finally {
    tx.close();
  }
}

