import { describe, it, expect } from "vitest";
import {
  parseOptions,
  validateAttributeValue,
  formatAttributeValue,
} from "@/lib/attributes";

describe("parseOptions", () => {
  it("returns string arrays as-is and drops non-strings", () => {
    expect(parseOptions(["S", "M", "L"])).toEqual(["S", "M", "L"]);
    expect(parseOptions(["A", 2, null, "B"])).toEqual(["A", "B"]);
  });
  it("returns [] for non-arrays", () => {
    expect(parseOptions(null)).toEqual([]);
    expect(parseOptions(undefined)).toEqual([]);
    expect(parseOptions("nope")).toEqual([]);
  });
});

describe("validateAttributeValue", () => {
  it("TEXT accepts any value; trims and caps length", () => {
    expect(validateAttributeValue("TEXT", "  Sony  ", [], false)).toEqual({ ok: true, value: "Sony" });
    const long = "x".repeat(600);
    const r = validateAttributeValue("TEXT", long, [], false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(500);
  });

  it("empty value: required fails, optional passes as empty", () => {
    expect(validateAttributeValue("TEXT", "", [], true)).toEqual({
      ok: false,
      error: "This field is required.",
    });
    expect(validateAttributeValue("TEXT", "   ", [], false)).toEqual({ ok: true, value: "" });
  });

  it("NUMBER accepts numeric strings, rejects non-numbers", () => {
    expect(validateAttributeValue("NUMBER", "12", [], false)).toEqual({ ok: true, value: "12" });
    expect(validateAttributeValue("NUMBER", "1.5", [], false)).toEqual({ ok: true, value: "1.5" });
    expect(validateAttributeValue("NUMBER", "abc", [], false).ok).toBe(false);
  });

  it("BOOLEAN normalises true/false case-insensitively, rejects others", () => {
    expect(validateAttributeValue("BOOLEAN", "TRUE", [], false)).toEqual({ ok: true, value: "true" });
    expect(validateAttributeValue("BOOLEAN", "False", [], false)).toEqual({ ok: true, value: "false" });
    expect(validateAttributeValue("BOOLEAN", "yes", [], false).ok).toBe(false);
  });

  it("SELECT requires the value to be one of the options", () => {
    expect(validateAttributeValue("SELECT", "256GB", ["128GB", "256GB"], false)).toEqual({
      ok: true,
      value: "256GB",
    });
    expect(validateAttributeValue("SELECT", "1TB", ["128GB", "256GB"], false).ok).toBe(false);
  });

  it("required + valid value passes for every type", () => {
    expect(validateAttributeValue("NUMBER", "5", [], true).ok).toBe(true);
    expect(validateAttributeValue("BOOLEAN", "true", [], true).ok).toBe(true);
    expect(validateAttributeValue("SELECT", "M", ["S", "M"], true).ok).toBe(true);
  });
});

describe("formatAttributeValue", () => {
  it("formats booleans and empties, passes text through", () => {
    expect(formatAttributeValue("BOOLEAN", "true")).toBe("Yes");
    expect(formatAttributeValue("BOOLEAN", "false")).toBe("No");
    expect(formatAttributeValue("TEXT", "")).toBe("—");
    expect(formatAttributeValue("NUMBER", "42")).toBe("42");
  });
});
