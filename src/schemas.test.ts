import { describe, it, expect } from "vitest";
import {
  PaymentRequirementsSchema,
  PartnerMetadataSchema,
  EnrichedResourceSchema,
} from "./schemas.js";

describe("PaymentRequirementsSchema", () => {
  it("validates a complete payment requirement", () => {
    const data = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "10000",
      resource: "https://api.example.com/resource",
      description: "API access",
      mimeType: "application/json",
      payTo: "0x1234567890abcdef1234567890abcdef12345678",
      maxTimeoutSeconds: 300,
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    };

    const result = PaymentRequirementsSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects invalid network", () => {
    const data = {
      scheme: "exact",
      network: "invalid-network",
      maxAmountRequired: "10000",
      resource: "https://api.example.com/resource",
      description: "API access",
      mimeType: "application/json",
      payTo: "0x1234",
      maxTimeoutSeconds: 300,
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    };

    const result = PaymentRequirementsSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects invalid resource URL", () => {
    const data = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "10000",
      resource: "not-a-url",
      description: "API access",
      mimeType: "application/json",
      payTo: "0x1234",
      maxTimeoutSeconds: 300,
      asset: "0x833589",
    };

    const result = PaymentRequirementsSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("PartnerMetadataSchema", () => {
  it("validates partner metadata with facilitator", () => {
    const data = {
      name: "Test Partner",
      description: "A test partner",
      logoUrl: "/logo.png",
      websiteUrl: "https://partner.com",
      category: "Facilitators",
      slug: "test-partner",
      facilitator: {
        baseUrl: "https://api.partner.com",
        networks: ["base", "solana"],
        schemes: ["exact"],
        assets: ["USDC"],
        supports: {
          verify: true,
          settle: true,
          supported: true,
          list: false,
        },
      },
    };

    const result = PartnerMetadataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("validates partner metadata without facilitator", () => {
    const data = {
      name: "Simple Partner",
      description: "A simple partner",
      logoUrl: "/logo.png",
      websiteUrl: "https://simple.com",
      category: "Services",
    };

    const result = PartnerMetadataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("EnrichedResourceSchema", () => {
  it("validates a complete enriched resource", () => {
    const data = {
      url: "https://api.example.com/paid-endpoint",
      name: "Example API",
      description: "A paid API endpoint",
      category: "Services",
      type: "http",
      x402Version: 1,
      health: {
        isAlive: true,
        statusCode: 402,
        latencyMs: 150,
        checkedAt: "2024-01-01T00:00:00Z",
      },
      pricing: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "10000",
          formattedAmount: "0.01 USDC",
          asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          payTo: "0x1234567890abcdef1234567890abcdef12345678",
          maxTimeoutSeconds: 300,
        },
      ],
      networksSupported: ["base"],
      accepts: [],
      lastUpdated: "2024-01-01T00:00:00Z",
      source: "discovery_api",
    };

    const result = EnrichedResourceSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("validates minimal enriched resource", () => {
    const data = {
      url: "https://api.example.com",
      type: "http",
      x402Version: 1,
      health: {
        isAlive: false,
        error: "Connection refused",
        checkedAt: "2024-01-01T00:00:00Z",
      },
      pricing: [],
      networksSupported: [],
      accepts: [],
      lastUpdated: "2024-01-01T00:00:00Z",
      source: "partners_data",
    };

    const result = EnrichedResourceSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});
