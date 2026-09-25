import { describe, expect, it } from "vitest";
import { resolveRequestId, sanitizeRequestId } from "./logger";

describe("sanitizeRequestId", () => {
  it("passes through a well-formed id unchanged", () => {
    expect(sanitizeRequestId("abc-123.def_456")).toBe("abc-123.def_456");
  });

  it("rejects null and empty values", () => {
    expect(sanitizeRequestId(null)).toBeNull();
    expect(sanitizeRequestId("")).toBeNull();
  });

  it("rejects a value over 128 characters", () => {
    expect(sanitizeRequestId("a".repeat(129))).toBeNull();
  });

  it("rejects embedded control characters, including a log-forging newline", () => {
    expect(sanitizeRequestId("abc\ndef")).toBeNull();
    expect(sanitizeRequestId("abc\r\nX-Injected: evil")).toBeNull();
    expect(sanitizeRequestId("abc\tdef")).toBeNull();
  });

  it("rejects whitespace and other characters outside the safe token charset", () => {
    expect(sanitizeRequestId("abc def")).toBeNull();
    expect(sanitizeRequestId("abc<script>")).toBeNull();
  });
});

describe("resolveRequestId", () => {
  function req(headers: Record<string, string> = {}) {
    return new Request("https://x.test/api/v1/products", { headers });
  }

  it("echoes a valid inbound x-request-id instead of replacing it", () => {
    expect(resolveRequestId(req({ "x-request-id": "caller-supplied-1" }))).toBe("caller-supplied-1");
  });

  it("mints a UUID when the caller sent no x-request-id", () => {
    expect(resolveRequestId(req())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("mints a fresh id instead of echoing an oversized (hostile) inbound value", () => {
    const hostile = "a".repeat(200);
    const id = resolveRequestId(req({ "x-request-id": hostile }));
    expect(id).not.toBe(hostile);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
