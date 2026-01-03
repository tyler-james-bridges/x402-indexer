#!/usr/bin/env node

/**
 * x402 Bazaar Indexer CLI
 *
 * A command-line tool for crawling and indexing x402-enabled APIs
 * from the Bazaar discovery layer.
 */

import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runIndexer } from "./indexer.js";
import { IndexerConfigSchema, type IndexerConfig } from "./schemas.js";
import { VERSION } from "./version.js";
import { closeDatabase } from "./db/index.js";

interface CLIOptions {
  facilitator: string;
  output: string;
  timeout: string;
  concurrency: string;
  partnersData?: string;
  skipHealthChecks: boolean;
  verbose: boolean;
  pretty: boolean;
  db: string;
  noDb: boolean;
  noJson: boolean;
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("x402-indexer")
    .description(
      "Crawl and index x402-enabled APIs from the Bazaar discovery layer"
    )
    .version(VERSION)
    .option(
      "-f, --facilitator <url>",
      "Base URL of the facilitator discovery API",
      "https://x402.org/facilitator"
    )
    .option(
      "-o, --output <path>",
      "Output file path for the enriched JSON",
      "./x402-index.json"
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      "10000"
    )
    .option(
      "-c, --concurrency <n>",
      "Number of concurrent health check requests",
      "5"
    )
    .option(
      "-p, --partners-data <path>",
      "Path to local partners-data directory to include"
    )
    .option(
      "--skip-health-checks",
      "Skip health checks and only fetch discovery data",
      false
    )
    .option("-v, --verbose", "Enable verbose logging", false)
    .option("--pretty", "Pretty-print the JSON output", false)
    .option("-d, --db <path>", "SQLite database path", "./x402.db")
    .option("--no-db", "Skip database persistence", false)
    .option("--no-json", "Skip JSON file output", false)
    .action(async (options: CLIOptions) => {
      try {
        // Parse and validate configuration
        const configInput = {
          facilitatorUrl: options.facilitator,
          outputPath: options.output,
          timeoutMs: parseInt(options.timeout, 10),
          concurrency: parseInt(options.concurrency, 10),
          includePartnersData: !!options.partnersData,
          partnersDataPath: options.partnersData,
          skipHealthChecks: options.skipHealthChecks,
          verbose: options.verbose,
          dbPath: options.db,
          persistToDb: !options.noDb,
          skipJsonOutput: options.noJson,
        };

        const configResult = IndexerConfigSchema.safeParse(configInput);
        if (!configResult.success) {
          console.error("Invalid configuration:");
          console.error(configResult.error.format());
          process.exit(1);
        }

        const config: IndexerConfig = configResult.data;

        // Run the indexer
        console.log("\n========================================");
        console.log("       x402 Bazaar Indexer v" + VERSION);
        console.log("========================================\n");

        const result = await runIndexer(config);

        // Write JSON output if not skipped
        if (!config.skipJsonOutput) {
          const outputPath = resolve(config.outputPath);
          const jsonContent = options.pretty
            ? JSON.stringify(result, null, 2)
            : JSON.stringify(result);

          await writeFile(outputPath, jsonContent, "utf-8");
        }

        console.log("\n========================================");
        console.log("            Indexing Complete");
        console.log("========================================");
        if (!config.skipJsonOutput) {
          console.log(`\nJSON output: ${resolve(config.outputPath)}`);
        }
        if (config.persistToDb) {
          console.log(`Database: ${resolve(config.dbPath)}`);
        }
        console.log(`\nSummary:`);
        console.log(`  Total resources: ${result.summary.totalResources}`);
        console.log(`  Alive: ${result.summary.aliveCount}`);
        console.log(`  Dead: ${result.summary.deadCount}`);
        if (result.summary.avgLatencyMs !== undefined) {
          console.log(`  Avg latency: ${result.summary.avgLatencyMs}ms`);
        }
        console.log(`  Duration: ${result.summary.indexDurationMs}ms`);
        console.log("\nBy category:");
        for (const [category, count] of Object.entries(
          result.summary.byCategory
        )) {
          console.log(`  ${category}: ${count}`);
        }
        console.log("\nBy network:");
        for (const [network, count] of Object.entries(
          result.summary.byNetwork
        )) {
          console.log(`  ${network}: ${count}`);
        }
        console.log("");
      } catch (error) {
        console.error(
          "Error:",
          error instanceof Error ? error.message : "Unknown error"
        );
        if (options.verbose && error instanceof Error) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });

  // Add a subcommand for checking a single endpoint
  program
    .command("check <url>")
    .description("Check a single x402 endpoint")
    .option("-t, --timeout <ms>", "Request timeout in milliseconds", "10000")
    .option("-v, --verbose", "Enable verbose logging", false)
    .action(
      async (
        url: string,
        checkOptions: { timeout: string; verbose: boolean }
      ) => {
        const { checkEndpoint } = await import("./health-checker.js");

        console.log(`\nChecking endpoint: ${url}\n`);

        const result = await checkEndpoint(
          url,
          parseInt(checkOptions.timeout, 10),
          checkOptions.verbose
        );

        console.log("Health Check Result:");
        console.log(`  Alive: ${result.health.isAlive}`);
        if (result.health.statusCode !== undefined) {
          console.log(`  Status: ${result.health.statusCode}`);
        }
        if (result.health.latencyMs !== undefined) {
          console.log(`  Latency: ${result.health.latencyMs}ms`);
        }
        if (result.health.error) {
          console.log(`  Error: ${result.health.error}`);
        }

        if (result.pricing.length > 0) {
          console.log("\nPricing Info:");
          for (const pricing of result.pricing) {
            console.log(`  Network: ${pricing.network}`);
            console.log(`  Scheme: ${pricing.scheme}`);
            console.log(`  Amount: ${pricing.formattedAmount ?? pricing.maxAmountRequired}`);
            console.log(`  Asset: ${pricing.asset}`);
            console.log(`  Pay To: ${pricing.payTo}`);
            console.log("  ---");
          }
        }

        console.log("");
      }
    );

  // Add a subcommand for listing supported networks
  program
    .command("networks")
    .description("List all supported x402 networks")
    .action(() => {
      const networks = [
        { name: "abstract", type: "EVM", testnet: false },
        { name: "abstract-testnet", type: "EVM", testnet: true },
        { name: "base", type: "EVM", testnet: false },
        { name: "base-sepolia", type: "EVM", testnet: true },
        { name: "avalanche", type: "EVM", testnet: false },
        { name: "avalanche-fuji", type: "EVM", testnet: true },
        { name: "iotex", type: "EVM", testnet: false },
        { name: "solana", type: "SVM", testnet: false },
        { name: "solana-devnet", type: "SVM", testnet: true },
        { name: "sei", type: "EVM", testnet: false },
        { name: "sei-testnet", type: "EVM", testnet: true },
        { name: "polygon", type: "EVM", testnet: false },
        { name: "polygon-amoy", type: "EVM", testnet: true },
        { name: "peaq", type: "EVM", testnet: false },
        { name: "story", type: "EVM", testnet: false },
        { name: "educhain", type: "EVM", testnet: false },
        { name: "skale-base-sepolia", type: "EVM", testnet: true },
      ];

      console.log("\nSupported x402 Networks:\n");
      console.log("Mainnets:");
      for (const net of networks.filter((n) => !n.testnet)) {
        console.log(`  ${net.name} (${net.type})`);
      }
      console.log("\nTestnets:");
      for (const net of networks.filter((n) => n.testnet)) {
        console.log(`  ${net.name} (${net.type})`);
      }
      console.log("");
    });

  // Database commands
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

  await program.parseAsync(process.argv);
}

// Cleanup database connection on exit
process.on("exit", () => {
  closeDatabase();
});

process.on("SIGINT", () => {
  closeDatabase();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDatabase();
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  closeDatabase();
  process.exit(1);
});
