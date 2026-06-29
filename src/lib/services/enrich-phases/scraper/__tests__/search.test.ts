import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { searchBrandUrls, parseApifySerpResults } from "../search"

afterEach(() => vi.unstubAllGlobals())

const MOCK_APIFY_RESPONSE = [
  {
    searchQuery: { term: "茶籽堂 台灣", url: "https://www.google.com.tw/search?q=%E8%8C%B6%E7%B1%BD%E5%A0%82+%E5%8F%B0%E7%81%A3" },
    organicResults: [
      { position: 1, title: "茶籽堂 Cha Tzu Tang", url: "https://www.chatzutang.com/", description: "..." },
      { position: 2, title: "茶籽堂 - Instagram", url: "https://www.instagram.com/chatzutang/", description: "..." },
      { position: 3, title: "茶籽堂 - Facebook", url: "https://www.facebook.com/chatzutang/", description: "..." },
      { position: 4, title: "茶籽堂 - Pinkoi", url: "https://www.pinkoi.com/store/chatzutang", description: "..." },
      { position: 5, title: "茶籽堂 - Shopee", url: "https://shopee.tw/chatzutang", description: "..." },
    ],
  },
]

describe("parseApifySerpResults", () => {
  it("extracts all URLs from organic results", () => {
    const urls = parseApifySerpResults(MOCK_APIFY_RESPONSE)
    expect(urls).toEqual([
      "https://www.chatzutang.com/",
      "https://www.instagram.com/chatzutang/",
      "https://www.facebook.com/chatzutang/",
      "https://www.pinkoi.com/store/chatzutang",
      "https://shopee.tw/chatzutang",
    ])
  })

  it("deduplicates URLs", () => {
    const duped = [
      {
        organicResults: [
          { position: 1, url: "https://www.example.com/" },
          { position: 2, url: "https://www.example.com/" },
        ],
      },
    ]
    expect(parseApifySerpResults(duped)).toEqual(["https://www.example.com/"])
  })

  it("returns empty array when no results", () => {
    expect(parseApifySerpResults([])).toEqual([])
  })

  it("handles entries with missing organicResults array", () => {
    expect(parseApifySerpResults([{ searchQuery: { term: "test" } }])).toEqual([])
  })

  it("skips entries with error field", () => {
    const withError = [{ error: "CAPTCHA", organicResults: [{ position: 1, url: "https://x.com" }] }]
    expect(parseApifySerpResults(withError)).toEqual([])
  })

  it("filters out google.com URLs from results", () => {
    const results = [
      {
        organicResults: [
          { position: 1, url: "https://www.example.com/" },
          { position: 2, url: "https://www.google.com/maps/place/..." },
          { position: 3, url: "https://translate.google.com/..." },
        ],
      },
    ]
    expect(parseApifySerpResults(results)).toEqual(["https://www.example.com/"])
  })
})

describe("searchBrandUrls", () => {
  beforeEach(() => {
    process.env.APIFY_TOKEN = "test-token"
  })

  afterEach(() => {
    delete process.env.APIFY_TOKEN
  })

  it("calls Apify sync endpoint and returns parsed URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(MOCK_APIFY_RESPONSE), { status: 200, headers: { "content-type": "application/json" } })),
    )

    const urls = await searchBrandUrls("茶籽堂")
    expect(urls).toHaveLength(5)
    expect(urls[0]).toBe("https://www.chatzutang.com/")

    const fetchCall = vi.mocked(fetch).mock.calls[0]
    const url = new URL(fetchCall[0] as string)
    expect(url.pathname).toContain("apify~google-search-scraper")
    expect(url.pathname).toContain("run-sync-get-dataset-items")

    const body = JSON.parse((fetchCall[1] as RequestInit).body as string)
    expect(body.queries).toBe("茶籽堂 台灣")
    expect(body.countryCode).toBe("tw")
    expect(body.maxPagesPerQuery).toBe(1)
  })

  it("returns empty array on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })))
    const urls = await searchBrandUrls("test")
    expect(urls).toEqual([])
  })

  it("returns empty array on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))
    const urls = await searchBrandUrls("test")
    expect(urls).toEqual([])
  })

  it("throws if APIFY_TOKEN is not set", async () => {
    delete process.env.APIFY_TOKEN
    await expect(searchBrandUrls("test")).rejects.toThrow("APIFY_TOKEN")
  })
})
