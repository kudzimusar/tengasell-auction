// R7 — return navigation and privacy, negative tests:
//   · the buyer's return URL is ALWAYS order-specific (#/orders/{id}) —
//     including when PAYNOW_RETURN_URL is set (the env is a base URL; a
//     trailing `/#/orders` fragment must not redirect to the list page)
//   · the sandbox redirect URL never carries the raw phone number
//   · the masked phone helper never emits the raw number

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { maskPhone, paynowUrls, sandboxRedirectUrl } from "@/lib/server/paynow-order";

afterEach(() => {
  delete process.env.PAYNOW_RETURN_URL;
});

describe("R7 — order-specific return navigation", () => {
  it("derives the return URL from the request origin, per order", () => {
    const { returnUrl, resultUrl } = paynowUrls("https://tengasell.example", 13);
    expect(returnUrl).toBe("https://tengasell.example/#/orders/13");
    expect(resultUrl).toBe("https://tengasell.example/api/paynow/callback");
  });

  it("PAYNOW_RETURN_URL (base) still lands on the buyer's specific order", () => {
    process.env.PAYNOW_RETURN_URL = "https://tengasell-zw.fly.dev";
    expect(paynowUrls("https://irrelevant.example", 13).returnUrl).toBe(
      "https://tengasell-zw.fly.dev/#/orders/13",
    );
  });

  it("a PAYNOW_RETURN_URL configured with a trailing /#/orders fragment is normalized to the order page", () => {
    process.env.PAYNOW_RETURN_URL = "https://tengasell-zw.fly.dev/#/orders";
    expect(paynowUrls("https://x.example", 13).returnUrl).toBe(
      "https://tengasell-zw.fly.dev/#/orders/13",
    );
  });

  it("a trailing slash on the configured base is normalized too", () => {
    process.env.PAYNOW_RETURN_URL = "https://tengasell-zw.fly.dev/";
    expect(paynowUrls("https://x.example", 13).returnUrl).toBe(
      "https://tengasell-zw.fly.dev/#/orders/13",
    );
  });
});

describe("R7 — sandbox redirect privacy", () => {
  it("never carries the raw phone number in the URL", () => {
    const url = sandboxRedirectUrl({
      reference: "TS-ORDR11-1760000000011",
      amount: 10,
      method: "ecocash",
      title: "Test item",
      orderId: 11,
    });
    expect(url).not.toContain("phone");
    expect(url).not.toContain("077");
    const parsed = new URL("http://localhost:3000/" + url.replace(/^#/, ""));
    expect(parsed.searchParams.has("phone")).toBe(false);
    expect(parsed.searchParams.get("amount")).toBe("10.00");
    expect(parsed.searchParams.get("order")).toBe("11");
    expect(parsed.searchParams.get("title")).toBe("Test item");
  });
});

describe("R7 — masked phone helper", () => {
  it("masks everything but the last four digits", () => {
    expect(maskPhone("07712343456")).toBe("••• ••• 3456");
    expect(maskPhone("+263 77 123 4345")).toBe("••• ••• 4345");
  });

  it("returns null for absent or digitless values", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
    expect(maskPhone("abc")).toBeNull();
  });
});
