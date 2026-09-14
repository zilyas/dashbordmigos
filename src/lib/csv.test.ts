import { describe, it, expect } from "vitest";
import { csvEscape } from "@/lib/csv";

describe("csvEscape — structural escaping", () => {
  it("leaves plain values untouched", () => {
    expect(csvEscape("Hello")).toBe("Hello");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(-5)).toBe("-5");
  });
  it("quotes values containing a comma, quote, or newline", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("csvEscape — formula-injection hardening", () => {
  it("prefixes text cells that start with a formula trigger", () => {
    expect(csvEscape("=1+2")).toBe("'=1+2");
    expect(csvEscape("+1")).toBe("'+1");
    expect(csvEscape("-cmd")).toBe("'-cmd");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("checks the trigger after leading whitespace but keeps the original text", () => {
    expect(csvEscape("  =SUM(A1)")).toBe("'  =SUM(A1)");
  });
  it("still quotes a neutralised value that also contains a comma", () => {
    expect(csvEscape("=1,2")).toBe(`"'=1,2"`);
  });
  it("neutralises the classic exfiltration payload so it cannot execute", () => {
    // This payload also contains quotes + a comma, so it is neutralised (leading
    // ') AND structurally wrapped — the cell must never begin with a bare `=`.
    const payload = '=HYPERLINK("http://evil","click")';
    const escaped = csvEscape(payload);
    expect(escaped).toBe(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(escaped).not.toMatch(/^=/);
  });
  it("never neutralises real numbers, including negatives", () => {
    expect(csvEscape(-42)).toBe("-42");
    expect(csvEscape(-0.5)).toBe("-0.5");
  });
  it("leaves benign text starting with other characters alone", () => {
    expect(csvEscape("Total")).toBe("Total");
    expect(csvEscape("2026-09")).toBe("2026-09");
  });
});
