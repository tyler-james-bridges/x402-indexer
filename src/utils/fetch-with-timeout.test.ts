import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout } from "./fetch-with-timeout.js";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("successful requests", () => {
    it("returns response on successful fetch", async () => {
      const mockResponse = new Response(JSON.stringify({ data: "test" }), {
        status: 200,
      });
      vi.spyOn(global, "fetch").mockResolvedValue(mockResponse);

      const response = await fetchWithTimeout("https://example.com/api", {
        timeoutMs: 5000,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: "test" });
    });

    it("passes method option to fetch", async () => {
      const mockResponse = new Response(null, { status: 204 });
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse);

      await fetchWithTimeout("https://example.com/api", {
        timeoutMs: 5000,
        method: "POST",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.com/api",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("passes headers option to fetch", async () => {
      const mockResponse = new Response(null, { status: 200 });
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse);

      await fetchWithTimeout("https://example.com/api", {
        timeoutMs: 5000,
        headers: { "Content-Type": "application/json" },
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.com/api",
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("passes body option to fetch", async () => {
      const mockResponse = new Response(null, { status: 201 });
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse);

      const body = JSON.stringify({ key: "value" });
      await fetchWithTimeout("https://example.com/api", {
        timeoutMs: 5000,
        method: "POST",
        body,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.com/api",
        expect.objectContaining({ body })
      );
    });
  });

  describe("timeout handling", () => {
    it("aborts request when timeout expires", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (_url, options) => {
        // Return a promise that only rejects when aborted
        if (options?.signal) {
          return new Promise<Response>((_, reject) => {
            options.signal!.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return new Response();
      });

      const responsePromise = fetchWithTimeout("https://slow.example.com", {
        timeoutMs: 1000,
      });

      // Advance time past the timeout
      vi.advanceTimersByTime(1001);

      await expect(responsePromise).rejects.toThrow("Aborted");
    });
  });

  describe("error handling", () => {
    it("propagates network errors", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

      await expect(
        fetchWithTimeout("https://example.com/api", { timeoutMs: 5000 })
      ).rejects.toThrow("Network error");
    });

    it("propagates DNS resolution errors", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(
        new Error("getaddrinfo ENOTFOUND example.invalid")
      );

      await expect(
        fetchWithTimeout("https://example.invalid", { timeoutMs: 5000 })
      ).rejects.toThrow("ENOTFOUND");
    });
  });

  describe("cleanup", () => {
    it("clears timeout on successful response", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const mockResponse = new Response(null, { status: 200 });
      vi.spyOn(global, "fetch").mockResolvedValue(mockResponse);

      await fetchWithTimeout("https://example.com/api", { timeoutMs: 5000 });

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("clears timeout on fetch error", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

      await expect(
        fetchWithTimeout("https://example.com/api", { timeoutMs: 5000 })
      ).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe("signal passthrough", () => {
    it("attaches abort signal to fetch request", async () => {
      const mockResponse = new Response(null, { status: 200 });
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockResponse);

      await fetchWithTimeout("https://example.com/api", { timeoutMs: 5000 });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.com/api",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });
});
