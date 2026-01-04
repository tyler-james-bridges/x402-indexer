/**
 * Database CLI Commands
 *
 * Commands for querying and managing the SQLite database.
 * These are optional admin commands separated from the core indexer.
 */

import type { Command } from "commander";

/**
 * Registers database-related subcommands with the CLI program
 */
export function registerDbCommands(program: Command): void {
  program
    .command("stats")
    .description("Show statistics from the database")
    .option("-d, --db <path>", "SQLite database path", "./x402.db")
    .action(async (opts: { db: string }) => {
      const { getInitializedDb, getStats } = await import("./db/index.js");

      const db = await getInitializedDb(opts.db);
      const stats = await getStats(db);

      console.log("\n========================================");
      console.log("         x402 Index Statistics");
      console.log("========================================\n");

      console.log(`Total resources: ${stats.totalResources}`);
      console.log(`  Alive: ${stats.aliveCount}`);
      console.log(`  Dead: ${stats.deadCount}`);
      if (stats.avgLatencyMs !== null) {
        console.log(`  Avg latency: ${Math.round(stats.avgLatencyMs)}ms`);
      }

      console.log("\nBy Category:");
      for (const [category, count] of Object.entries(stats.byCategory)) {
        console.log(`  ${category}: ${count}`);
      }

      console.log("\nBy Network:");
      for (const [network, count] of Object.entries(stats.byNetwork)) {
        console.log(`  ${network}: ${count}`);
      }

      console.log("\nBy Source:");
      for (const [source, count] of Object.entries(stats.bySource)) {
        console.log(`  ${source}: ${count}`);
      }
      console.log("");
    });

  program
    .command("list")
    .description("List resources from the database")
    .option("-d, --db <path>", "SQLite database path", "./x402.db")
    .option("-s, --status <status>", "Filter by status (alive|dead|all)", "all")
    .option("-n, --network <network>", "Filter by network")
    .option("-c, --category <category>", "Filter by category")
    .option("-q, --search <query>", "Search in URL, name, description")
    .option("-l, --limit <n>", "Limit results", "20")
    .action(
      async (opts: {
        db: string;
        status: string;
        network?: string;
        category?: string;
        search?: string;
        limit: string;
      }) => {
        const { getInitializedDb, getResources } = await import("./db/index.js");

        const db = await getInitializedDb(opts.db);
        const filter: {
          status: "alive" | "dead" | "all";
          network?: string;
          category?: string;
          search?: string;
          limit: number;
        } = {
          status: opts.status as "alive" | "dead" | "all",
          limit: parseInt(opts.limit, 10),
        };
        if (opts.network) filter.network = opts.network;
        if (opts.category) filter.category = opts.category;
        if (opts.search) filter.search = opts.search;

        const resources = await getResources(db, filter);

        console.log(`\nFound ${resources.length} resources:\n`);

        for (const resource of resources) {
          const status = resource.health?.is_alive ? "✓" : "✗";
          const latency = resource.health?.latency_ms
            ? `${resource.health.latency_ms}ms`
            : "N/A";
          const networks = JSON.parse(resource.networks_supported) as string[];

          console.log(`${status} ${resource.url}`);
          if (resource.name) {
            console.log(`    Name: ${resource.name}`);
          }
          console.log(`    Networks: ${networks.join(", ")}`);
          console.log(`    Latency: ${latency}`);
          if (resource.health?.uptime_7d !== null && resource.health?.uptime_7d !== undefined) {
            console.log(`    Uptime (7d): ${resource.health.uptime_7d.toFixed(1)}%`);
          }
          console.log("");
        }
      }
    );

  program
    .command("history <url>")
    .description("Show health check history for a resource")
    .option("-d, --db <path>", "SQLite database path", "./x402.db")
    .option("-l, --limit <n>", "Limit results", "20")
    .action(async (url: string, opts: { db: string; limit: string }) => {
      const { getInitializedDb, getResourceByUrl, getHealthHistory } = await import(
        "./db/index.js"
      );

      const db = await getInitializedDb(opts.db);
      const resource = await getResourceByUrl(db, url);
      if (!resource) {
        console.error(`Resource not found: ${url}`);
        process.exit(1);
      }

      const history = await getHealthHistory(
        db,
        resource.id,
        parseInt(opts.limit, 10)
      );

      console.log(`\nHealth history for: ${url}\n`);
      console.log("Checked At                  Status    Latency    Error");
      console.log("─".repeat(70));

      for (const check of history) {
        const status = check.isAlive ? "✓ Alive" : "✗ Dead ";
        const latency = check.latencyMs ? `${check.latencyMs}ms` : "N/A";
        const error = check.error ? check.error.slice(0, 20) : "";
        console.log(
          `${check.checkedAt}  ${status}   ${latency.padEnd(10)} ${error}`
        );
      }
      console.log("");
    });

  program
    .command("runs")
    .description("Show index run history")
    .option("-d, --db <path>", "SQLite database path", "./x402.db")
    .option("-l, --limit <n>", "Limit results", "10")
    .action(async (opts: { db: string; limit: string }) => {
      const { getInitializedDb, getIndexRuns } = await import("./db/index.js");

      const db = await getInitializedDb(opts.db);
      const runs = await getIndexRuns(db, parseInt(opts.limit, 10));

      console.log("\nRecent index runs:\n");
      console.log(
        "Started At                  Status      Resources  Alive  Dead   Duration"
      );
      console.log("─".repeat(80));

      for (const run of runs) {
        const resources = run.total_resources?.toString() ?? "N/A";
        const alive = run.alive_count?.toString() ?? "N/A";
        const dead = run.dead_count?.toString() ?? "N/A";
        const duration = run.duration_ms ? `${run.duration_ms}ms` : "N/A";
        console.log(
          `${run.started_at}  ${run.status.padEnd(10)}  ${resources.padEnd(10)} ${alive.padEnd(6)} ${dead.padEnd(6)} ${duration}`
        );
      }
      console.log("");
    });

  program
    .command("cleanup")
    .description("Clean up old data from the database")
    .option("-d, --db <path>", "SQLite database path", "./x402.db")
    .option(
      "--health-days <n>",
      "Keep health checks from last N days",
      "30"
    )
    .option(
      "--stale-days <n>",
      "Remove resources not seen in N days",
      "7"
    )
    .option("--dry-run", "Show what would be deleted without deleting")
    .action(
      async (opts: {
        db: string;
        healthDays: string;
        staleDays: string;
        dryRun?: boolean;
      }) => {
        const { getInitializedDb, cleanupOldHealthChecks, cleanupStaleResources } = await import(
          "./db/index.js"
        );

        const db = await getInitializedDb(opts.db);
        const healthDays = parseInt(opts.healthDays, 10);
        const staleDays = parseInt(opts.staleDays, 10);

        if (opts.dryRun) {
          console.log("\nDry run - no changes will be made\n");
        }

        console.log(`Cleaning up health checks older than ${healthDays} days...`);
        if (!opts.dryRun) {
          const healthDeleted = await cleanupOldHealthChecks(db, healthDays);
          console.log(`  Deleted ${healthDeleted} health check records`);
        }

        console.log(`\nCleaning up resources not seen in ${staleDays} days...`);
        if (!opts.dryRun) {
          const resourcesDeleted = await cleanupStaleResources(db, staleDays);
          console.log(`  Deleted ${resourcesDeleted} stale resources`);
        }

        console.log("\nCleanup complete!\n");
      }
    );
}
