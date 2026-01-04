/**
 * Database Repository
 *
 * Data access layer for x402 indexed resources.
 */

import type { Client, Transaction } from "@libsql/client";
import type {
  EnrichedResource,
  HealthCheckResult,
  PricingInfo,
  IndexSummary,
} from "../schemas.js";
import { randomUUID } from "node:crypto";

// =============================================================================
// Types
// =============================================================================

export interface ResourceRow {
  id: string;
  url: string;
  name: string | null;
  description: string | null;
  category: string | null;
  type: string;
  x402_version: number;
  source: string;
  networks_supported: string;
  metadata: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_updated: string | null;
}

export interface HealthRow {
  resource_id: string;
  is_alive: number;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
  uptime_7d: number | null;
  avg_latency_7d: number | null;
  check_count_7d: number | null;
}

export interface ResourceFilter {
  status?: "alive" | "dead" | "all";
  network?: string;
  category?: string;
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ResourceWithHealth extends ResourceRow {
  health: HealthRow | null;
  pricing: PricingInfo[];
}

// Type alias for row data from libsql
type RowData = Record<string, unknown>;

// Helper to map a joined row to ResourceWithHealth
function mapRowToResource(row: RowData, pricing: PricingInfo[]): ResourceWithHealth {
  const resourceId = row["id"] as string;
  const healthCheckedAt = row["health_checked_at"] as string | null;

  return {
    id: resourceId,
    url: row["url"] as string,
    name: row["name"] as string | null,
    description: row["description"] as string | null,
    category: row["category"] as string | null,
    type: row["type"] as string,
    x402_version: row["x402_version"] as number,
    source: row["source"] as string,
    networks_supported: row["networks_supported"] as string,
    metadata: row["metadata"] as string | null,
    first_seen_at: row["first_seen_at"] as string,
    last_seen_at: row["last_seen_at"] as string,
    last_updated: row["last_updated"] as string | null,
    health: healthCheckedAt !== null
      ? {
          resource_id: resourceId,
          is_alive: row["health_is_alive"] as number,
          status_code: row["health_status_code"] as number | null,
          latency_ms: row["health_latency_ms"] as number | null,
          error: row["health_error"] as string | null,
          checked_at: healthCheckedAt,
          uptime_7d: row["uptime_7d"] as number | null,
          avg_latency_7d: row["avg_latency_7d"] as number | null,
          check_count_7d: row["check_count_7d"] as number | null,
        }
      : null,
    pricing,
  };
}

// Helper to map payment requirement rows to PricingInfo array
function mapPricingRows(rows: RowData[]): PricingInfo[] {
  return rows.map((p) => ({
    scheme: p["scheme"] as string,
    network: p["network"] as string,
    maxAmountRequired: p["max_amount_required"] as string,
    formattedAmount: p["formatted_amount"] as string | undefined,
    asset: p["asset"] as string,
    payTo: p["pay_to"] as string,
    maxTimeoutSeconds: p["max_timeout_seconds"] as number,
  }));
}

// =============================================================================
// Resource Operations
// =============================================================================

/**
 * Upsert a resource (insert or update)
 */
export async function upsertResource(
  db: Client,
  resource: EnrichedResource
): Promise<string> {
  const tx = await db.transaction("write");

  try {
    const id = randomUUID();
    const networksJson = JSON.stringify(resource.networksSupported);
    const metadataJson = resource.metadata
      ? JSON.stringify(resource.metadata)
      : null;

    await tx.execute({
      sql: `
        INSERT INTO resources (
          id, url, name, description, category, type, x402_version,
          source, networks_supported, metadata, last_updated, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(url) DO UPDATE SET
          name = COALESCE(excluded.name, resources.name),
          description = COALESCE(excluded.description, resources.description),
          category = COALESCE(excluded.category, resources.category),
          x402_version = excluded.x402_version,
          networks_supported = excluded.networks_supported,
          metadata = COALESCE(excluded.metadata, resources.metadata),
          last_updated = excluded.last_updated,
          last_seen_at = datetime('now'),
          updated_at = datetime('now')
      `,
      args: [
        id,
        resource.url,
        resource.name ?? null,
        resource.description ?? null,
        resource.category ?? null,
        resource.type,
        resource.x402Version,
        resource.source,
        networksJson,
        metadataJson,
        resource.lastUpdated,
      ],
    });

    // Get the actual ID (might be existing row)
    const result = await tx.execute({
      sql: "SELECT id FROM resources WHERE url = ?",
      args: [resource.url],
    });

    const resourceId = result.rows[0]!["id"] as string;

    // Upsert payment requirements
    for (const pricing of resource.pricing) {
      await upsertPaymentRequirementTx(tx, resourceId, pricing);
    }

    // Insert health check
    await insertHealthCheckTx(tx, resourceId, resource.health);

    // Update current health status
    await updateResourceHealthTx(tx, resourceId, resource.health);

    await tx.commit();
    return resourceId;
  } finally {
    tx.close();
  }
}

/**
 * Upsert payment requirement (transaction version)
 */
async function upsertPaymentRequirementTx(
  tx: Transaction,
  resourceId: string,
  pricing: PricingInfo
): Promise<void> {
  await tx.execute({
    sql: `
      INSERT INTO payment_requirements (
        id, resource_id, scheme, network, asset, max_amount_required,
        formatted_amount, pay_to, max_timeout_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_id, network, asset) DO UPDATE SET
        scheme = excluded.scheme,
        max_amount_required = excluded.max_amount_required,
        formatted_amount = excluded.formatted_amount,
        pay_to = excluded.pay_to,
        max_timeout_seconds = excluded.max_timeout_seconds
    `,
    args: [
      randomUUID(),
      resourceId,
      pricing.scheme,
      pricing.network,
      pricing.asset,
      pricing.maxAmountRequired ?? "0",
      pricing.formattedAmount ?? null,
      pricing.payTo,
      pricing.maxTimeoutSeconds ?? 0,
    ],
  });
}

/**
 * Insert a health check record (transaction version)
 */
async function insertHealthCheckTx(
  tx: Transaction,
  resourceId: string,
  health: HealthCheckResult
): Promise<void> {
  await tx.execute({
    sql: `
      INSERT INTO health_checks (
        resource_id, is_alive, status_code, latency_ms, error, checked_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [
      resourceId,
      health.isAlive ? 1 : 0,
      health.statusCode ?? null,
      health.latencyMs ?? null,
      health.error ?? null,
      health.checkedAt,
    ],
  });
}

/**
 * Update current health status (transaction version)
 */
async function updateResourceHealthTx(
  tx: Transaction,
  resourceId: string,
  health: HealthCheckResult
): Promise<void> {
  // Calculate 7-day stats
  const stats = await tx.execute({
    sql: `
      SELECT
        COUNT(*) as total_checks,
        SUM(CASE WHEN is_alive = 1 THEN 1 ELSE 0 END) as alive_checks,
        AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) as avg_latency
      FROM health_checks
      WHERE resource_id = ?
        AND checked_at >= datetime('now', '-7 days')
    `,
    args: [resourceId],
  });

  const row = stats.rows[0]!;
  const totalChecks = (row["total_checks"] as number) ?? 0;
  const aliveChecks = (row["alive_checks"] as number) ?? 0;
  const avgLatency = row["avg_latency"] as number | null;
  const uptime7d = totalChecks > 0 ? (aliveChecks / totalChecks) * 100 : null;

  await tx.execute({
    sql: `
      INSERT INTO resource_health (
        resource_id, is_alive, status_code, latency_ms, error, checked_at,
        uptime_7d, avg_latency_7d, check_count_7d
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_id) DO UPDATE SET
        is_alive = excluded.is_alive,
        status_code = excluded.status_code,
        latency_ms = excluded.latency_ms,
        error = excluded.error,
        checked_at = excluded.checked_at,
        uptime_7d = excluded.uptime_7d,
        avg_latency_7d = excluded.avg_latency_7d,
        check_count_7d = excluded.check_count_7d
    `,
    args: [
      resourceId,
      health.isAlive ? 1 : 0,
      health.statusCode ?? null,
      health.latencyMs ?? null,
      health.error ?? null,
      health.checkedAt,
      uptime7d,
      avgLatency,
      totalChecks,
    ],
  });
}

/**
 * Get all resources with optional filtering
 */
export async function getResources(
  db: Client,
  filter: ResourceFilter = {}
): Promise<ResourceWithHealth[]> {
  const conditions: string[] = ["1=1"];
  const args: (string | number)[] = [];

  if (filter.status === "alive") {
    conditions.push("rh.is_alive = 1");
  } else if (filter.status === "dead") {
    conditions.push("(rh.is_alive = 0 OR rh.is_alive IS NULL)");
  }

  if (filter.network) {
    conditions.push("r.networks_supported LIKE ?");
    args.push(`%${filter.network}%`);
  }

  if (filter.category) {
    conditions.push("r.category = ?");
    args.push(filter.category);
  }

  if (filter.source) {
    conditions.push("r.source = ?");
    args.push(filter.source);
  }

  if (filter.search) {
    conditions.push("(r.url LIKE ? OR r.name LIKE ? OR r.description LIKE ?)");
    const searchPattern = `%${filter.search}%`;
    args.push(searchPattern, searchPattern, searchPattern);
  }

  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;
  args.push(limit, offset);

  const result = await db.execute({
    sql: `
      SELECT
        r.*,
        rh.is_alive as health_is_alive,
        rh.status_code as health_status_code,
        rh.latency_ms as health_latency_ms,
        rh.error as health_error,
        rh.checked_at as health_checked_at,
        rh.uptime_7d,
        rh.avg_latency_7d,
        rh.check_count_7d
      FROM resources r
      LEFT JOIN resource_health rh ON r.id = rh.resource_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY rh.is_alive DESC, rh.latency_ms ASC NULLS LAST
      LIMIT ? OFFSET ?
    `,
    args,
  });

  if (result.rows.length === 0) {
    return [];
  }

  // Collect all resource IDs
  const resourceIds = result.rows.map((row) => row["id"] as string);

  // Fetch all payment requirements in ONE query (fixes N+1)
  const placeholders = resourceIds.map(() => "?").join(",");
  const pricingResult = await db.execute({
    sql: `SELECT * FROM payment_requirements WHERE resource_id IN (${placeholders})`,
    args: resourceIds,
  });

  // Group pricing by resource_id
  const pricingByResource = new Map<string, PricingInfo[]>();
  for (const p of pricingResult.rows) {
    const resId = p["resource_id"] as string;
    const existing = pricingByResource.get(resId) ?? [];
    existing.push({
      scheme: p["scheme"] as string,
      network: p["network"] as string,
      maxAmountRequired: p["max_amount_required"] as string,
      formattedAmount: p["formatted_amount"] as string | undefined,
      asset: p["asset"] as string,
      payTo: p["pay_to"] as string,
      maxTimeoutSeconds: p["max_timeout_seconds"] as number,
    });
    pricingByResource.set(resId, existing);
  }

  // Build final result using helper
  return result.rows.map((row) => {
    const resourceId = row["id"] as string;
    return mapRowToResource(row, pricingByResource.get(resourceId) ?? []);
  });
}

/**
 * Get a single resource by URL (uses exact match with index)
 */
export async function getResourceByUrl(
  db: Client,
  url: string
): Promise<ResourceWithHealth | null> {
  const result = await db.execute({
    sql: `
      SELECT
        r.*,
        rh.is_alive as health_is_alive,
        rh.status_code as health_status_code,
        rh.latency_ms as health_latency_ms,
        rh.error as health_error,
        rh.checked_at as health_checked_at,
        rh.uptime_7d,
        rh.avg_latency_7d,
        rh.check_count_7d
      FROM resources r
      LEFT JOIN resource_health rh ON r.id = rh.resource_id
      WHERE r.url = ?
    `,
    args: [url],
  });

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;
  const resourceId = row["id"] as string;

  // Fetch pricing for this resource
  const pricingResult = await db.execute({
    sql: "SELECT * FROM payment_requirements WHERE resource_id = ?",
    args: [resourceId],
  });

  return mapRowToResource(row, mapPricingRows(pricingResult.rows));
}

/**
 * Get health check history for a resource
 */
export async function getHealthHistory(
  db: Client,
  resourceId: string,
  limit = 100
): Promise<HealthCheckResult[]> {
  const result = await db.execute({
    sql: `
      SELECT * FROM health_checks
      WHERE resource_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `,
    args: [resourceId, limit],
  });

  return result.rows.map((row) => ({
    isAlive: (row["is_alive"] as number) === 1,
    statusCode: row["status_code"] as number | undefined,
    latencyMs: row["latency_ms"] as number | undefined,
    error: row["error"] as string | undefined,
    checkedAt: row["checked_at"] as string,
  }));
}

// =============================================================================
// Index Run Operations
// =============================================================================

/**
 * Start a new index run
 */
export async function startIndexRun(
  db: Client,
  facilitatorUrl: string,
  indexerVersion: string
): Promise<number> {
  const result = await db.execute({
    sql: `
      INSERT INTO index_runs (started_at, facilitator_url, indexer_version, status)
      VALUES (datetime('now'), ?, ?, 'running')
    `,
    args: [facilitatorUrl, indexerVersion],
  });

  return Number(result.lastInsertRowid);
}

/**
 * Complete an index run
 */
export async function completeIndexRun(
  db: Client,
  runId: number,
  summary: IndexSummary
): Promise<void> {
  await db.execute({
    sql: `
      UPDATE index_runs SET
        completed_at = datetime('now'),
        total_resources = ?,
        alive_count = ?,
        dead_count = ?,
        avg_latency_ms = ?,
        duration_ms = ?,
        status = 'completed'
      WHERE id = ?
    `,
    args: [
      summary.totalResources,
      summary.aliveCount,
      summary.deadCount,
      summary.avgLatencyMs ?? null,
      summary.indexDurationMs,
      runId,
    ],
  });
}

/**
 * Fail an index run
 */
export async function failIndexRun(
  db: Client,
  runId: number,
  error: string
): Promise<void> {
  await db.execute({
    sql: `
      UPDATE index_runs SET
        completed_at = datetime('now'),
        status = 'failed',
        error = ?
      WHERE id = ?
    `,
    args: [error, runId],
  });
}

/**
 * Get recent index runs
 */
export async function getIndexRuns(
  db: Client,
  limit = 10
): Promise<
  Array<{
    id: number;
    started_at: string;
    completed_at: string | null;
    total_resources: number | null;
    alive_count: number | null;
    dead_count: number | null;
    duration_ms: number | null;
    status: string;
  }>
> {
  const result = await db.execute({
    sql: `
      SELECT * FROM index_runs
      ORDER BY started_at DESC
      LIMIT ?
    `,
    args: [limit],
  });

  return result.rows.map((row) => ({
    id: row["id"] as number,
    started_at: row["started_at"] as string,
    completed_at: row["completed_at"] as string | null,
    total_resources: row["total_resources"] as number | null,
    alive_count: row["alive_count"] as number | null,
    dead_count: row["dead_count"] as number | null,
    duration_ms: row["duration_ms"] as number | null,
    status: row["status"] as string,
  }));
}

// =============================================================================
// Statistics
// =============================================================================

/**
 * Get aggregate statistics
 */
export async function getStats(db: Client): Promise<{
  totalResources: number;
  aliveCount: number;
  deadCount: number;
  avgLatencyMs: number | null;
  byCategory: Record<string, number>;
  byNetwork: Record<string, number>;
  bySource: Record<string, number>;
}> {
  // Total counts
  const totals = await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN rh.is_alive = 1 THEN 1 ELSE 0 END) as alive,
      AVG(CASE WHEN rh.latency_ms IS NOT NULL THEN rh.latency_ms END) as avg_latency
    FROM resources r
    LEFT JOIN resource_health rh ON r.id = rh.resource_id
  `);

  // By category
  const categories = await db.execute(`
    SELECT COALESCE(category, 'Uncategorized') as category, COUNT(*) as count
    FROM resources
    GROUP BY category
  `);

  // By network (need to parse JSON)
  const networks = await db.execute(`
    SELECT networks_supported FROM resources
  `);

  const networkCounts: Record<string, number> = {};
  for (const row of networks.rows) {
    const nets = JSON.parse(row["networks_supported"] as string) as string[];
    for (const net of nets) {
      networkCounts[net] = (networkCounts[net] ?? 0) + 1;
    }
  }

  // By source
  const sources = await db.execute(`
    SELECT source, COUNT(*) as count
    FROM resources
    GROUP BY source
  `);

  const totalsRow = totals.rows[0]!;
  const totalResources = (totalsRow["total"] as number) ?? 0;
  const aliveCount = (totalsRow["alive"] as number) ?? 0;

  return {
    totalResources,
    aliveCount,
    deadCount: totalResources - aliveCount,
    avgLatencyMs: totalsRow["avg_latency"] as number | null,
    byCategory: Object.fromEntries(
      categories.rows.map((r) => [r["category"] as string, r["count"] as number])
    ),
    byNetwork: networkCounts,
    bySource: Object.fromEntries(
      sources.rows.map((r) => [r["source"] as string, r["count"] as number])
    ),
  };
}

// =============================================================================
// Maintenance
// =============================================================================

/**
 * Clean up old health check records (keep last N days)
 */
export async function cleanupOldHealthChecks(
  db: Client,
  daysToKeep = 30
): Promise<number> {
  const result = await db.execute({
    sql: `
      DELETE FROM health_checks
      WHERE checked_at < datetime('now', ? || ' days')
    `,
    args: [`-${daysToKeep}`],
  });

  return result.rowsAffected;
}

/**
 * Remove resources not seen in the last N days
 */
export async function cleanupStaleResources(
  db: Client,
  daysUnseen = 7
): Promise<number> {
  const result = await db.execute({
    sql: `
      DELETE FROM resources
      WHERE last_seen_at < datetime('now', ? || ' days')
    `,
    args: [`-${daysUnseen}`],
  });

  return result.rowsAffected;
}
