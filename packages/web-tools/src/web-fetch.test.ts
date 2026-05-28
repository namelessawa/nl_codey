import { describe, it, expect } from "vitest";
import { extractReadableText, truncate, webFetch } from "./web-fetch.js";
import { WEB_FETCH_MAX_CHARS } from "@coding-agent/shared";

describe("extractReadableText", () => {
  it("strips a script tag and returns clean text", () => {
    const html =
      "<html><body><h1>Title</h1><script>alert('x')</script><p>Hello world</p></body></html>";
    const text = extractReadableText(html);
    expect(text).toContain("Title");
    expect(text).toContain("Hello world");
    expect(text).not.toContain("alert");
  });

  it("strips style/nav/footer/header blocks", () => {
    const html =
      "<header>nope</header><nav>menu</nav><style>.a{}</style><main>Keep</main><footer>bye</footer>";
    const text = extractReadableText(html);
    expect(text).toBe("Keep");
  });

  it("decodes common entities and collapses whitespace", () => {
    const html = "<p>a &amp; b\n\n  &lt;tag&gt;&nbsp;c</p>";
    expect(extractReadableText(html)).toBe("a & b <tag> c");
  });
});

describe("truncate", () => {
  it("flags truncated: true past the cap", () => {
    const long = "x".repeat(WEB_FETCH_MAX_CHARS + 10);
    const result = truncate(long);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(WEB_FETCH_MAX_CHARS);
  });

  it("does not flag short text", () => {
    const result = truncate("short");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("short");
  });
});

describe("webFetch", () => {
  it("fetches, extracts, and truncates a whitelisted URL", async () => {
    const fetchImpl = (async () =>
      new Response("<p>Doc body &amp; more</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const out = await webFetch(
      { url: "https://foo.github.io/page" },
      { whitelist: ["*.github.io"], fetchImpl },
    );

    expect(out.url).toBe("https://foo.github.io/page");
    expect(out.text).toBe("Doc body & more");
    expect(out.truncated).toBe(false);
  });

  it("rejects a non-whitelisted host before fetching", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      webFetch({ url: "https://evil.com/x" }, { whitelist: ["*.github.io"], fetchImpl }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("throws on a non-ok HTTP status", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof fetch;

    await expect(
      webFetch({ url: "https://foo.github.io/missing" }, { whitelist: ["*.github.io"], fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
