# x402 Bazaar Indexer

A TypeScript crawler/indexer that enriches x402 ecosystem data from the Bazaar discovery layer. This tool fetches x402-enabled API endpoints, performs health checks, measures latency, and generates an enriched JSON index that can be served statically or used for monitoring.

## Features

- Fetches resources from the x402 facilitator discovery API
- Performs concurrent health checks on all discovered endpoints
- Measures response latency for each endpoint
- Parses X-Payment headers and 402 response bodies for pricing info
- Supports loading local partner metadata from the x402 ecosystem
- Generates comprehensive statistics and summaries
- **SQLite persistence** for historical tracking and uptime monitoring
- CLI with multiple commands for different use cases
- Fully typed with Zod schema validation

## Installation

```bash
# Clone and install dependencies
npm install

# Build the project
npm run build

# Run directly with tsx (development)
npm run dev

# Or install globally after building
npm link
```

## Requirements

- Node.js 20+
- npm or yarn

## Usage

### Basic Usage

Run the indexer with default settings:

```bash
# Development mode
npm run dev

# Production mode (after build)
npm start

# Or if installed globally
x402-indexer
```

### CLI Options

```
Usage: x402-indexer [options] [command]

Crawl and index x402-enabled APIs from the Bazaar discovery layer

Options:
  -V, --version              output the version number
  -f, --facilitator <url>    Base URL of the facilitator discovery API
                             (default: "https://x402.org/facilitator")
  -o, --output <path>        Output file path for the enriched JSON
                             (default: "./x402-index.json")
  -t, --timeout <ms>         Request timeout in milliseconds (default: "10000")
  -c, --concurrency <n>      Number of concurrent health check requests
                             (default: "5")
  -p, --partners-data <path> Path to local partners-data directory to include
  --skip-health-checks       Skip health checks and only fetch discovery data
  -v, --verbose              Enable verbose logging
  --pretty                   Pretty-print the JSON output
  -d, --db <path>            SQLite database path (default: "./x402.db")
  --skip-db                  Skip database persistence
  --skip-json                Skip JSON file output
  -h, --help                 display help for command

Commands:
  check <url>                Check a single x402 endpoint
  networks                   List all supported x402 networks
  stats                      Show statistics from the database
  list                       List resources from the database
  history <url>              Show health check history for a resource
  runs                       Show index run history
  cleanup                    Clean up old data from the database
```

### Examples

```bash
# Run with verbose logging and pretty output
x402-indexer --verbose --pretty

# Custom output path and higher concurrency
x402-indexer -o ./data/index.json -c 10

# Include local partner metadata
x402-indexer -p /path/to/x402/typescript/site/app/ecosystem/partners-data

# Skip health checks (faster, just fetch discovery data)
x402-indexer --skip-health-checks

# Check a single endpoint
x402-indexer check https://api.example.com/protected

# List supported networks
x402-indexer networks

# Skip database persistence (JSON only)
x402-indexer --skip-db

# Skip JSON output (database only)
x402-indexer --skip-json

# View database statistics
x402-indexer stats

# List alive resources from database
x402-indexer list --status alive

# View health history for a resource
x402-indexer history https://api.example.com/protected

# Clean up old data
x402-indexer cleanup --health-days 30 --stale-days 7
```

## Output Format

The indexer generates a JSON file with the following structure:

```json
{
  "meta": {
    "version": "1.0.0",
    "generatedAt": "2024-01-15T12:00:00.000Z",
    "facilitatorUrl": "https://x402.org/facilitator"
  },
  "summary": {
    "totalResources": 25,
    "aliveCount": 22,
    "deadCount": 3,
    "avgLatencyMs": 245,
    "minLatencyMs": 89,
    "maxLatencyMs": 1234,
    "byCategory": {
      "Services/Endpoints": 15,
      "Facilitators": 5,
      "Infrastructure & Tooling": 5
    },
    "byNetwork": {
      "base": 18,
      "base-sepolia": 12,
      "solana": 8
    },
    "indexedAt": "2024-01-15T12:00:00.000Z",
    "indexDurationMs": 5432,
    "indexerVersion": "1.0.0"
  },
  "resources": [
    {
      "url": "https://api.example.com/protected",
      "name": "Example API",
      "description": "An x402-enabled API",
      "category": "Services/Endpoints",
      "type": "http",
      "x402Version": 1,
      "health": {
        "isAlive": true,
        "statusCode": 402,
        "latencyMs": 156,
        "checkedAt": "2024-01-15T12:00:00.000Z"
      },
      "pricing": [
        {
          "scheme": "exact",
          "network": "base",
          "maxAmountRequired": "1000000",
          "formattedAmount": "1 USDC",
          "asset": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          "payTo": "0x...",
          "maxTimeoutSeconds": 60
        }
      ],
      "networksSupported": ["base", "base-sepolia"],
      "accepts": [...],
      "lastUpdated": "2024-01-15T10:00:00.000Z",
      "source": "discovery_api"
    }
  ]
}
```

## Running as a Cron Job

Create a script to run the indexer periodically:

```bash
#!/bin/bash
# index-x402.sh

cd /path/to/x402-indexer
npm start -- -o /var/www/static/x402-index.json --pretty
```

Add to crontab to run every hour:

```crontab
0 * * * * /path/to/index-x402.sh >> /var/log/x402-indexer.log 2>&1
```

## GitHub Actions

You can run this indexer as a GitHub Action:

```yaml
name: Index x402 Bazaar

on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:      # Manual trigger

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run indexer
        run: npm start -- -o ./x402-index.json --pretty

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: x402-index
          path: ./x402-index.json
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Build for production
npm run build

# Clean build artifacts
npm run clean
```

## Architecture

```
src/
  cli.ts            # CLI entry point with Commander
  db-commands.ts    # Database admin commands (stats, list, history, etc.)
  index.ts          # Public API exports
  indexer.ts        # Main orchestration logic
  fetcher.ts        # Discovery API and partner data fetching
  health-checker.ts # Endpoint health checks and payment parsing
  logger.ts         # Simple logging utility
  schemas.ts        # Zod schemas for all data types
  db/
    client.ts       # SQLite database connection
    schema.ts       # Database table definitions
    repository.ts   # Data access layer
    index.ts        # Database module exports
  utils/
    fetch-with-timeout.ts  # HTTP fetch with timeout handling
    formatting.ts          # Amount formatting utilities
    url-validator.ts       # URL validation
```

## Supported Networks

The indexer supports all x402 networks:

**Mainnets:**
- Base (EVM)
- Avalanche (EVM)
- Polygon (EVM)
- Solana (SVM)
- Abstract (EVM)
- IoTeX (EVM)
- Sei (EVM)
- Peaq (EVM)
- Story (EVM)
- Educhain (EVM)

**Testnets:**
- Base Sepolia
- Avalanche Fuji
- Polygon Amoy
- Solana Devnet
- Abstract Testnet
- Sei Testnet
- SKALE Base Sepolia

## Contributing

This tool is designed to potentially be contributed to the [coinbase/x402](https://github.com/coinbase/x402) repository. Please follow the x402 contribution guidelines when submitting PRs.

## License

MIT
