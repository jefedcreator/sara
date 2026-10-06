import { describe, expect, it, vi } from "vitest";
import { cleanAuthFragment, CLEAN_AUTH_FRAGMENT_SCRIPT } from "./auth-fragment";

describe("cleanAuthFragment", () => {
  it("strips #_=_ hash via replaceState while preserving pathname and search", () => {
    const replaceState = vi.fn();
    const fakeWin = {
      location: {
        hash: "#_=_",
        pathname: "/dashboard",
        search: "?tab=overview",
      },
      history: {
        replaceState,
      },
    };

    cleanAuthFragment(fakeWin);

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/dashboard?tab=overview",
    );
  });

  it("strips legacy #_ hash via replaceState", () => {
    const replaceState = vi.fn();
    const fakeWin = {
      location: {
        hash: "#_",
        pathname: "/onboarding",
        search: "",
      },
      history: {
        replaceState,
      },
    };

    cleanAuthFragment(fakeWin);

    expect(replaceState).toHaveBeenCalledWith(null, "", "/onboarding");
  });

  it("does not strip legitimate anchor fragments", () => {
    const replaceState = vi.fn();
    const fakeWin = {
      location: {
        hash: "#section-features",
        pathname: "/docs",
        search: "",
      },
      history: {
        replaceState,
      },
    };

    cleanAuthFragment(fakeWin);

    expect(replaceState).not.toHaveBeenCalled();
  });

  it("handles missing window or history gracefully without throwing", () => {
    expect(() => cleanAuthFragment(undefined)).not.toThrow();
  });

  it("contains valid inline script syntax", () => {
    expect(CLEAN_AUTH_FRAGMENT_SCRIPT).toContain("window.location.hash");
    expect(CLEAN_AUTH_FRAGMENT_SCRIPT).toContain("#_=_");
    expect(CLEAN_AUTH_FRAGMENT_SCRIPT).toContain("replaceState");
  });
});

