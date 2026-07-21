import { describe, expect, test } from "bun:test";
import { fetchUrl, isBlockedFetchAddress } from "./fetch-url";

describe("fetch_url network boundary", () => {
  test("allows ordinary public IPv4 and IPv6 addresses", () => {
    expect(isBlockedFetchAddress("185.15.59.224")).toBeFalse();
    expect(isBlockedFetchAddress("2606:4700:4700::1111")).toBeFalse();
  });

  test.each([
    "http://127.0.0.1:3000/private",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://localhost/",
    "http://metadata.google.internal/",
  ])("rejects private or local target %s", async (url) => {
    expect(fetchUrl(url)).rejects.toThrow(/local|private|reserved/u);
  });

  test("rejects embedded URL credentials", async () => {
    expect(fetchUrl("https://user:password@example.com/")).rejects.toThrow(
      "URLs containing credentials are not supported",
    );
  });
});
