import { describe, it, expect } from "vitest";
import { validateUrl } from "./url-validator.js";

describe("validateUrl", () => {
  describe("protocol validation", () => {
    it("accepts https:// URLs", () => {
      const result = validateUrl("https://example.com/api");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("rejects http:// URLs", () => {
      const result = validateUrl("http://example.com/api");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("https://");
    });

    it("rejects ftp:// URLs", () => {
      const result = validateUrl("ftp://example.com/file");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("https://");
    });

    it("rejects file:// URLs", () => {
      const result = validateUrl("file:///etc/passwd");
      expect(result.valid).toBe(false);
    });
  });

  describe("blocked hostnames", () => {
    it("blocks localhost", () => {
      const result = validateUrl("https://localhost/api");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked hostname");
    });

    it("blocks 127.0.0.1", () => {
      const result = validateUrl("https://127.0.0.1/api");
      expect(result.valid).toBe(false);
    });

    it("blocks 0.0.0.0", () => {
      const result = validateUrl("https://0.0.0.0/api");
      expect(result.valid).toBe(false);
    });

    it("blocks ::1", () => {
      const result = validateUrl("https://[::1]/api");
      expect(result.valid).toBe(false);
    });

    it("blocks cloud metadata endpoint", () => {
      const result = validateUrl("https://169.254.169.254/latest/meta-data");
      expect(result.valid).toBe(false);
    });
  });

  describe("private IPv4 ranges", () => {
    it("blocks 10.x.x.x (10.0.0.0/8)", () => {
      expect(validateUrl("https://10.0.0.1/api").valid).toBe(false);
      expect(validateUrl("https://10.255.255.255/api").valid).toBe(false);
    });

    it("blocks 172.16-31.x.x (172.16.0.0/12)", () => {
      expect(validateUrl("https://172.16.0.1/api").valid).toBe(false);
      expect(validateUrl("https://172.31.255.255/api").valid).toBe(false);
      // 172.15.x.x should be allowed (outside private range)
      expect(validateUrl("https://172.15.0.1/api").valid).toBe(true);
      // 172.32.x.x should be allowed (outside private range)
      expect(validateUrl("https://172.32.0.1/api").valid).toBe(true);
    });

    it("blocks 192.168.x.x (192.168.0.0/16)", () => {
      expect(validateUrl("https://192.168.0.1/api").valid).toBe(false);
      expect(validateUrl("https://192.168.255.255/api").valid).toBe(false);
      // 192.167.x.x should be allowed
      expect(validateUrl("https://192.167.0.1/api").valid).toBe(true);
    });

    it("blocks 169.254.x.x (link-local)", () => {
      expect(validateUrl("https://169.254.0.1/api").valid).toBe(false);
      expect(validateUrl("https://169.254.255.255/api").valid).toBe(false);
    });

    it("blocks 127.x.x.x (loopback)", () => {
      expect(validateUrl("https://127.0.0.1/api").valid).toBe(false);
      expect(validateUrl("https://127.255.255.255/api").valid).toBe(false);
    });

    it("blocks 0.x.x.x (current network)", () => {
      expect(validateUrl("https://0.0.0.0/api").valid).toBe(false);
      expect(validateUrl("https://0.1.2.3/api").valid).toBe(false);
    });
  });

  describe("private IPv6 ranges", () => {
    it("blocks ::1 (loopback)", () => {
      const result = validateUrl("https://[::1]/api");
      expect(result.valid).toBe(false);
    });

    it("blocks :: (unspecified)", () => {
      const result = validateUrl("https://[::]/api");
      expect(result.valid).toBe(false);
    });

    it("blocks fc00::/7 (unique local addresses)", () => {
      expect(validateUrl("https://[fc00::1]/api").valid).toBe(false);
      expect(validateUrl("https://[fd00::1]/api").valid).toBe(false);
    });

    it("blocks fe80::/10 (link-local)", () => {
      expect(validateUrl("https://[fe80::1]/api").valid).toBe(false);
      expect(validateUrl("https://[feb0::1]/api").valid).toBe(false);
    });

    it("blocks IPv4-mapped IPv6 for private IPv4", () => {
      // ::ffff:10.0.0.1 is IPv4-mapped for 10.0.0.1
      expect(validateUrl("https://[::ffff:10.0.0.1]/api").valid).toBe(false);
      expect(validateUrl("https://[::ffff:192.168.1.1]/api").valid).toBe(false);
    });
  });

  describe("valid public URLs", () => {
    it("accepts public domain names", () => {
      expect(validateUrl("https://example.com/api").valid).toBe(true);
      expect(validateUrl("https://api.x402.org/resources").valid).toBe(true);
      expect(validateUrl("https://coinbase.com/api/v2").valid).toBe(true);
    });

    it("accepts public IPv4 addresses", () => {
      expect(validateUrl("https://8.8.8.8/api").valid).toBe(true);
      expect(validateUrl("https://1.1.1.1/api").valid).toBe(true);
    });

    it("accepts URLs with ports", () => {
      expect(validateUrl("https://example.com:443/api").valid).toBe(true);
      expect(validateUrl("https://example.com:8443/api").valid).toBe(true);
    });

    it("accepts URLs with query strings", () => {
      expect(validateUrl("https://example.com/api?key=value").valid).toBe(true);
    });

    it("accepts URLs with paths", () => {
      expect(validateUrl("https://example.com/api/v1/resources/123").valid).toBe(true);
    });
  });

  describe("malformed URLs", () => {
    it("rejects empty string", () => {
      const result = validateUrl("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid URL format");
    });

    it("rejects invalid URL format", () => {
      expect(validateUrl("not-a-url").valid).toBe(false);
      expect(validateUrl("://missing-protocol.com").valid).toBe(false);
    });

    it("rejects URL without protocol", () => {
      expect(validateUrl("example.com/api").valid).toBe(false);
    });
  });
});
