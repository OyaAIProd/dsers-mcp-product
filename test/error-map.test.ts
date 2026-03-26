import { describe, it, expect } from "vitest";
import { formatErrorForAgent } from "../src/error-map.js";

describe("formatErrorForAgent", () => {
  describe("DSers reason codes", () => {
    it("TOKEN_EXPIRED maps to session expired message", () => {
      const err = { message: 'DSers API error: {"reason":"TOKEN_EXPIRED"}' };
      const result = formatErrorForAgent(err);
      expect(result).toContain("session expired");
      expect(result).toContain("login");
    });

    it("ALIBABA_NOT_AVAILABLE mentions MOQ", () => {
      const err = { message: '{"reason":"ALIBABA_NOT_AVAILABLE"}' };
      const result = formatErrorForAgent(err);
      expect(result).toContain("MOQ");
    });

    it("IMPORT_LIST_PRODUCT_ALREADY_EXISTS handled", () => {
      const err = { message: '{"reason":"IMPORT_LIST_PRODUCT_ALREADY_EXISTS"}' };
      const result = formatErrorForAgent(err);
      expect(result).toContain("already in import list");
    });
  });

  describe("message pattern matching", () => {
    it("credentials not configured → login instruction", () => {
      const result = formatErrorForAgent(new Error("credentials not configured"));
      expect(result).toContain("login");
      expect(result).toContain("STOP");
    });

    it("Unknown job_id → re-import suggestion", () => {
      const result = formatErrorForAgent(new Error("Unknown job_id: abc123"));
      expect(result).toContain("dsers.product.import");
    });

    it("No linked stores found → connect store", () => {
      const result = formatErrorForAgent(new Error("No linked stores found"));
      expect(result).toContain("connect");
    });

    it("Multiple stores are available → discover stores", () => {
      const result = formatErrorForAgent(new Error("Multiple stores are available: Store A, Store B"));
      expect(result).toContain("dsers.store.discover");
    });

    it("source_url is required → provide URL", () => {
      const result = formatErrorForAgent(new Error("source_url is required"));
      expect(result).toContain("source_url");
    });

    it("Push blocked by safety check → show to user", () => {
      const result = formatErrorForAgent(new Error("Push blocked by safety check:\nVariant has zero price"));
      expect(result).toContain("Push blocked");
      expect(result).toContain("force_push");
    });

    it("504 Gateway Timeout → retry", () => {
      const result = formatErrorForAgent(new Error("504 Gateway Time-out"));
      expect(result).toContain("retry");
    });

    it("SyntaxError → JSON fix", () => {
      const result = formatErrorForAgent(new Error("SyntaxError: Unexpected token"));
      expect(result).toContain("JSON");
    });
  });

  describe("fallback handling", () => {
    it("unknown error returns raw message with retry suggestion", () => {
      const result = formatErrorForAgent(new Error("Something completely random"));
      expect(result).toContain("Something completely random");
      expect(result).toContain("retry");
    });

    it("non-Error value handled gracefully", () => {
      const result = formatErrorForAgent("plain string error");
      expect(result).toContain("plain string error");
    });
  });

  describe("no reference to non-existent tools", () => {
    it("push-guard action mentions re-apply mode, not dsers.product.rules.reapply", () => {
      const result = formatErrorForAgent(new Error("Push blocked by safety check:\nBad price"));
      expect(result).not.toContain("dsers.product.rules.reapply");
      expect(result).toContain("re-apply mode");
    });
  });
});
