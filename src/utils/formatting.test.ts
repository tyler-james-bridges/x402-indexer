import { describe, it, expect } from "vitest";
import { formatAmount, getAssetSymbol } from "./formatting.js";

describe("getAssetSymbol", () => {
  it("returns USDC for Base mainnet USDC address", () => {
    expect(getAssetSymbol("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe("USDC");
  });

  it("returns USDC for Base Sepolia USDC address", () => {
    expect(getAssetSymbol("0x036CbD53842c5426634e7929541eC2318f3dCF7e")).toBe("USDC");
  });

  it("returns USDC for assets containing USDC in name", () => {
    expect(getAssetSymbol("USDC")).toBe("USDC");
    expect(getAssetSymbol("wrapped-USDC")).toBe("USDC");
  });

  it("shortens unknown 0x addresses", () => {
    expect(getAssetSymbol("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234...5678");
  });

  it("returns short addresses as-is", () => {
    expect(getAssetSymbol("0x1234")).toBe("0x1234");
  });

  it("returns non-address assets as-is", () => {
    expect(getAssetSymbol("ETH")).toBe("ETH");
    expect(getAssetSymbol("SOL")).toBe("SOL");
  });
});

describe("formatAmount", () => {
  const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

  it("formats 1 USDC correctly (1000000 atomic)", () => {
    expect(formatAmount("1000000", USDC)).toBe("1 USDC");
  });

  it("formats 0.01 USDC correctly (10000 atomic)", () => {
    expect(formatAmount("10000", USDC)).toBe("0.01 USDC");
  });

  it("formats 0.000001 USDC correctly (1 atomic)", () => {
    expect(formatAmount("1", USDC)).toBe("0.000001 USDC");
  });

  it("formats large amounts correctly", () => {
    expect(formatAmount("1000000000000", USDC)).toBe("1000000 USDC");
  });

  it("trims trailing zeros in fractional part", () => {
    expect(formatAmount("1500000", USDC)).toBe("1.5 USDC");
    expect(formatAmount("1230000", USDC)).toBe("1.23 USDC");
  });

  it("handles zero", () => {
    expect(formatAmount("0", USDC)).toBe("0 USDC");
  });

  it("returns raw format for invalid input", () => {
    expect(formatAmount("not-a-number", USDC)).toBe("not-a-number (raw)");
  });

  it("uses shortened address for unknown assets (defaults to 18 decimals)", () => {
    const unknownAsset = "0xdeadbeef1234567890abcdef1234567890abcdef";
    // Unknown ERC20 tokens default to 18 decimals
    expect(formatAmount("1000000000000000000", unknownAsset)).toBe("1 0xdead...cdef");
  });
});
