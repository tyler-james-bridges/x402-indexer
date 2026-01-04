/**
 * Formatting utilities for x402 payment data
 */

/**
 * Token info: symbol and decimals
 */
interface TokenInfo {
  symbol: string;
  decimals: number;
}

/**
 * Known token addresses mapped to their info (lowercase for comparison)
 * Key format: lowercase address
 */
const KNOWN_TOKENS: Record<string, TokenInfo> = {
  // USDC (6 decimals)
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 }, // Base mainnet
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 }, // Base Sepolia
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6 }, // Arbitrum
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 }, // Ethereum
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC", decimals: 6 }, // Polygon
  "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": { symbol: "USDC", decimals: 6 }, // Avalanche
  "epjfwdd5aufqssqem2qn1xzybapC8g4weggkzwytdt1v": { symbol: "USDC", decimals: 6 }, // Solana

  // USDT (6 decimals)
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 }, // Ethereum
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { symbol: "USDT", decimals: 6 }, // Polygon

  // WETH (18 decimals)
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18 }, // Ethereum
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 }, // Base/Optimism

  // WBTC (8 decimals)
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { symbol: "WBTC", decimals: 8 }, // Ethereum

  // DAI (18 decimals)
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18 }, // Ethereum
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { symbol: "DAI", decimals: 18 }, // Base
};

/**
 * Gets token info for an asset address, with fallback defaults
 */
function getTokenInfo(asset: string): TokenInfo {
  const lowerAsset = asset.toLowerCase();

  // Check known tokens
  const known = KNOWN_TOKENS[lowerAsset];
  if (known) {
    return known;
  }

  // Check if asset name contains known symbols
  const upperAsset = asset.toUpperCase();
  if (upperAsset.includes("USDC") || upperAsset.includes("USDT")) {
    return { symbol: upperAsset.includes("USDC") ? "USDC" : "USDT", decimals: 6 };
  }
  if (upperAsset.includes("WETH") || upperAsset.includes("ETH")) {
    return { symbol: "ETH", decimals: 18 };
  }
  if (upperAsset.includes("WBTC") || upperAsset.includes("BTC")) {
    return { symbol: "BTC", decimals: 8 };
  }
  if (upperAsset.includes("DAI")) {
    return { symbol: "DAI", decimals: 18 };
  }

  // Unknown token - default to 18 decimals (most common for ERC20)
  // Return shortened address as symbol
  const symbol = asset.startsWith("0x") && asset.length > 10
    ? `${asset.slice(0, 6)}...${asset.slice(-4)}`
    : asset;

  return { symbol, decimals: 18 };
}

/**
 * Gets a human-readable symbol for an asset address
 */
export function getAssetSymbol(asset: string): string {
  return getTokenInfo(asset).symbol;
}

/**
 * Gets the number of decimals for an asset
 */
export function getAssetDecimals(asset: string): number {
  return getTokenInfo(asset).decimals;
}

/**
 * Formats an atomic amount into a human-readable string
 * Automatically detects decimals based on known token addresses
 */
export function formatAmount(atomicAmount: string, asset: string): string {
  try {
    const amount = BigInt(atomicAmount);
    const { symbol, decimals } = getTokenInfo(asset);
    const divisor = BigInt(10 ** decimals);
    const wholePart = amount / divisor;
    const fractionalPart = amount % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");

    // Truncate trailing zeros
    const trimmedFractional = fractionalStr.replace(/0+$/, "") || "0";

    if (trimmedFractional === "0") {
      return `${wholePart} ${symbol}`;
    }
    return `${wholePart}.${trimmedFractional} ${symbol}`;
  } catch {
    return `${atomicAmount} (raw)`;
  }
}
