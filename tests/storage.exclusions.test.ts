import { describe, expect, it } from "vitest";
import {
  addExcludedSite,
  getExcludedSites,
  isSiteExcluded,
  normalizeSiteInput,
  removeExcludedSite,
} from "@/lib/storage";

describe("excluded site storage helpers", () => {
  it("normalizes hostname and URL inputs", () => {
    expect(normalizeSiteInput(" EXAMPLE.com ")).toBe("example.com");
    expect(normalizeSiteInput("https://WWW.Example.com/path?q=1")).toBe("www.example.com");
    expect(normalizeSiteInput("example.com.")).toBe("example.com");
    expect(normalizeSiteInput("")).toBeNull();
    expect(normalizeSiteInput("::::")).toBeNull();
  });

  it("adds, dedupes, sorts, checks, and removes excluded sites", async () => {
    await addExcludedSite("zeta.com");
    await addExcludedSite("https://ALPHA.com/path");
    await addExcludedSite("alpha.com");

    expect(await getExcludedSites()).toEqual(["alpha.com", "zeta.com"]);
    expect(await isSiteExcluded("https://alpha.com/article")).toBe(true);
    expect(await isSiteExcluded("beta.com")).toBe(false);

    await removeExcludedSite("https://alpha.com");
    expect(await getExcludedSites()).toEqual(["zeta.com"]);
    expect(await isSiteExcluded("alpha.com")).toBe(false);
  });
});
