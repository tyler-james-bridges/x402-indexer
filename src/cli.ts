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
import { IndexerConfigSchema, NetworkSchema, type IndexerConfig } from "./schemas.js";
import { VERSION } from "./version.js";
import { closeDatabase } from "./db/index.js";
import { registerDbCommands } from "./db-commands.js";

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
  skipDb: boolean;
  skipJson: boolean;
  skipDiscovery: boolean;
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
      "Base URL of the CDP discovery API",
      "https://api.cdp.coinbase.com/platform/v2/x402"
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
    .option("--skip-db", "Skip database persistence", false)
    .option("--skip-json", "Skip JSON file output", false)
    .option(
      "--skip-discovery",
      "Skip the deprecated discovery API (recommended)",
      false
    )
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
          persistToDb: !options.skipDb,
          skipJsonOutput: options.skipJson,
          skipDiscoveryApi: options.skipDiscovery,
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
      // Derive networks from schema - metadata for VM type
      const vmTypes: Record<string, string> = {
        solana: "SVM",
        "solana-devnet": "SVM",
      };

      // Get all networks from schema
      const allNetworks = NetworkSchema.options;
      const networks = allNetworks.map((name) => ({
        name,
        type: vmTypes[name] ?? "EVM",
        testnet: name.includes("testnet") || name.includes("sepolia") ||
                 name.includes("devnet") || name.includes("fuji") ||
                 name.includes("amoy"),
      }));

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

  // Register database admin commands (stats, list, history, runs, cleanup)
  registerDbCommands(program);

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
