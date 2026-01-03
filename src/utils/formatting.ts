/**
 * Formatting utilities for x402 payment data
 */

/**
 * Known USDC addresses on various networks
 */
const USDC_ADDRESSES = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base mainnet
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Base Sepolia
  "epjfwdd5aufqssqem2qn1xzybapC8g4weggkzwytdt1v", // Solana (lowercase)
]);

/**
 * Gets a human-readable symbol for an asset address
 */
export function getAssetSymbol(asset: string): string {
  const lowerAsset = asset.toLowerCase();

  if (USDC_ADDRESSES.has(lowerAsset) || asset.includes("USDC")) {
    return "USDC";
  }

  // Return shortened address if unknown
  if (asset.startsWith("0x") && asset.length > 10) {
    return `${asset.slice(0, 6)}...${asset.slice(-4)}`;
  }

  return asset;
}

/**
 * Formats an atomic amount into a human-readable string
 *
 * Assumes 6 decimals (USDC standard). For other assets, you'd need
 * to look up the actual decimals.
 */
export function formatAmount(atomicAmount: string, asset: string): string {
  try {
    const amount = BigInt(atomicAmount);
    const decimals = 6;
    const divisor = BigInt(10 ** decimals);
    const wholePart = amount / divisor;
    const fractionalPart = amount % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");

    // Truncate trailing zeros
    const trimmedFractional = fractionalStr.replace(/0+$/, "") || "0";
    const symbol = getAssetSymbol(asset);

    if (trimmedFractional === "0") {
      return `${wholePart} ${symbol}`;
    }
    return `${wholePart}.${trimmedFractional} ${symbol}`;
  } catch {
    return `${atomicAmount} (raw)`;
  }
}
