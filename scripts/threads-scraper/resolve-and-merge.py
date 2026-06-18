#!/usr/bin/env python3
"""
Merge brands from vk123 blog + Threads extraction, resolve profile URLs
to actual website URLs, and output a unified brands JSON ready for enrich.ts.

Usage:
    python3 scripts/threads-scraper/resolve-and-merge.py

Input:
    output/vk123-mit-brands.json       — blog-scraped brands
    output/threads-extracted-brands.json — Threads-extracted brands

Output:
    output/all-brands-merged.json      — deduped, with resolved URLs
"""

import json
import re
import sys
import time
import random
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
STATE_FILE = Path(__file__).parent / "auth-state.json"

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False


def normalize_name(name: str) -> str:
    """Normalize a brand name for dedup comparison."""
    n = name.lower().strip()
    n = re.sub(r'[^\w一-鿿]', '', n)
    return n


def is_profile_url(url: str) -> bool:
    """Check if a URL is a social profile rather than a brand website."""
    return any(domain in url for domain in [
        "threads.com/@", "threads.net/@",
        "instagram.com/",
        "facebook.com/share",
    ])


def is_marketplace_url(url: str) -> bool:
    """Check if URL is a marketplace listing, not the brand's own site."""
    return any(domain in url for domain in [
        "shopee.tw", "momoshop.com", "pchome.com",
    ])


def extract_ig_handle(url: str) -> str:
    """Extract IG handle from a URL."""
    m = re.search(r'instagram\.com/([a-zA-Z0-9_.]+)', url)
    return m.group(1) if m else ""


def extract_threads_handle(url: str) -> str:
    """Extract Threads handle from a URL."""
    m = re.search(r'threads\.(com|net)/@([a-zA-Z0-9_.]+)', url)
    return m.group(2) if m else ""


def resolve_threads_profiles(brands: list[dict]) -> list[dict]:
    """Visit Threads profile pages and extract the website link from bio."""
    if not HAS_PLAYWRIGHT:
        print("Playwright not available, skipping profile resolution", file=sys.stderr)
        return brands

    # Collect brands that need resolution
    to_resolve = []
    for i, b in enumerate(brands):
        url = b.get("url", "")
        if url and is_profile_url(url) and "threads" in url:
            handle = extract_threads_handle(url)
            if handle:
                to_resolve.append((i, handle, url))

    if not to_resolve:
        print("No Threads profiles to resolve", file=sys.stderr)
        return brands

    print(f"Resolving {len(to_resolve)} Threads profiles to websites...", file=sys.stderr)

    resolved_count = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx_opts = {
            "viewport": {"width": 1280, "height": 900},
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        }
        if STATE_FILE.exists():
            ctx_opts["storage_state"] = str(STATE_FILE)

        context = browser.new_context(**ctx_opts)
        page = context.new_page()

        for idx, (brand_idx, handle, profile_url) in enumerate(to_resolve):
            if idx > 0 and idx % 50 == 0:
                print(f"  ... resolved {idx}/{len(to_resolve)}", file=sys.stderr)

            try:
                threads_url = f"https://www.threads.net/@{handle}"
                page.goto(threads_url, wait_until="domcontentloaded", timeout=10000)
                page.wait_for_timeout(2000)

                # Look for external link in bio — usually an <a> with the brand's website
                links = page.evaluate("""
                    () => {
                        const anchors = document.querySelectorAll('a[href]');
                        const external = [];
                        for (const a of anchors) {
                            const href = a.href;
                            if (href && !href.includes('threads.') && !href.includes('instagram.') &&
                                !href.includes('facebook.com') && !href.includes('about.meta') &&
                                !href.includes('help.instagram') && !href.includes('l.threads.net') &&
                                href.startsWith('http')) {
                                external.push(href);
                            }
                        }
                        // Also check for l.threads.net redirect links (bio links)
                        for (const a of anchors) {
                            const href = a.href;
                            if (href && href.includes('l.threads.net')) {
                                external.push(href);
                            }
                        }
                        return external;
                    }
                """)

                # Also try to extract from visible text (some bios show URL as text)
                bio_links = page.evaluate("""
                    () => {
                        const spans = document.querySelectorAll('span');
                        const urls = [];
                        for (const s of spans) {
                            const text = s.textContent || '';
                            const match = text.match(/https?:\\/\\/[^\\s]+/);
                            if (match) urls.push(match[0]);
                            // Also match bare domains
                            const domain = text.match(/(?:www\\.)?[a-zA-Z0-9-]+\\.(com|tw|co|io|shop|store|me)\\.?(?:tw)?/);
                            if (domain) urls.push('https://' + domain[0]);
                        }
                        return urls;
                    }
                """)

                all_links = links + bio_links
                # Filter to likely brand websites
                website = ""
                for link in all_links:
                    if is_profile_url(link) or is_marketplace_url(link):
                        continue
                    if "l.threads.net" in link:
                        # This is a redirect — we'll keep it, enrich.ts can follow it
                        website = link
                        break
                    website = link
                    break

                if website:
                    # Move profile URL to appropriate social field, set website as url
                    brands[brand_idx]["url"] = website
                    if "instagram" not in brands[brand_idx]:
                        brands[brand_idx]["instagram"] = f"https://www.instagram.com/{handle}/"
                    resolved_count += 1

                time.sleep(random.uniform(0.5, 1.5))

            except Exception as e:
                pass  # Skip failures silently

        browser.close()

    print(f"  Resolved {resolved_count}/{len(to_resolve)} profiles to websites", file=sys.stderr)
    return brands


def merge_brands(vk123_path: Path, threads_path: Path) -> list[dict]:
    """Merge and deduplicate brands from both sources."""
    brands = []
    seen_names = set()

    # Load vk123 brands (primary source — has productType mapping)
    if vk123_path.exists():
        with open(vk123_path) as f:
            vk123 = json.load(f)
        print(f"Loaded {len(vk123)} brands from vk123", file=sys.stderr)
        for b in vk123:
            norm = normalize_name(b["name"])
            if norm and norm not in seen_names:
                seen_names.add(norm)
                brands.append(b)

    # Load Threads-extracted brands (supplement)
    if threads_path.exists():
        with open(threads_path) as f:
            threads = json.load(f)
        print(f"Loaded {len(threads)} brands from Threads extraction", file=sys.stderr)
        added = 0
        enriched = 0
        for b in threads:
            norm = normalize_name(b["name"])
            if not norm:
                continue
            if norm in seen_names:
                # Brand already exists — enrich with any additional info
                for existing in brands:
                    if normalize_name(existing["name"]) == norm:
                        # Add URL if existing doesn't have one or has a profile URL
                        if b.get("url") and (not existing.get("url") or is_profile_url(existing.get("url", ""))):
                            if not is_profile_url(b["url"]):
                                existing["url"] = b["url"]
                                enriched += 1
                        # Add social links if missing
                        for field in ["instagram", "facebook"]:
                            if b.get(field) and not existing.get(field):
                                existing[field] = b[field]
                        # Append context
                        if b.get("context") and b["context"] not in existing.get("context", ""):
                            existing["context"] = existing.get("context", "") + " | " + b["context"]
                        break
            else:
                seen_names.add(norm)
                brands.append(b)
                added += 1
        print(f"  Added {added} new brands, enriched {enriched} existing", file=sys.stderr)
    else:
        print(f"No Threads extraction file found at {threads_path}", file=sys.stderr)

    return brands


def classify_urls(brands: list[dict]) -> dict:
    """Classify brands by URL type for reporting."""
    stats = {"website": 0, "threads_profile": 0, "ig_profile": 0, "marketplace": 0, "no_url": 0}
    for b in brands:
        url = b.get("url", "")
        if not url:
            if b.get("instagram"):
                stats["ig_profile"] += 1
            else:
                stats["no_url"] += 1
        elif "threads" in url and "/@" in url:
            stats["threads_profile"] += 1
        elif "instagram.com" in url:
            stats["ig_profile"] += 1
        elif is_marketplace_url(url):
            stats["marketplace"] += 1
        else:
            stats["website"] += 1
    return stats


def main():
    vk123_path = OUTPUT_DIR / "vk123-mit-brands.json"
    threads_path = OUTPUT_DIR / "threads-extracted-brands.json"
    out_path = OUTPUT_DIR / "all-brands-merged.json"

    # Step 1: Merge
    print("=== Step 1: Merge sources ===", file=sys.stderr)
    brands = merge_brands(vk123_path, threads_path)
    print(f"Total after merge: {len(brands)}", file=sys.stderr)

    stats = classify_urls(brands)
    print(f"\nURL classification:", file=sys.stderr)
    for k, v in stats.items():
        print(f"  {k}: {v}", file=sys.stderr)

    # Step 2: Resolve Threads profiles to websites
    print("\n=== Step 2: Resolve Threads profiles ===", file=sys.stderr)
    brands = resolve_threads_profiles(brands)

    stats_after = classify_urls(brands)
    print(f"\nAfter resolution:", file=sys.stderr)
    for k, v in stats_after.items():
        print(f"  {k}: {v}", file=sys.stderr)

    # Step 3: For brands with only IG profile URL and no website, move IG to instagram field
    for b in brands:
        url = b.get("url", "")
        if url and "instagram.com" in url:
            if "instagram" not in b:
                b["instagram"] = url
            b.pop("url", None)
        elif url and ("threads.com/@" in url or "threads.net/@" in url):
            handle = extract_threads_handle(url)
            if handle and "instagram" not in b:
                b["instagram"] = f"https://www.instagram.com/{handle}/"
            b.pop("url", None)

    # Step 4: Write output
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(brands, f, ensure_ascii=False, indent=2)

    print(f"\n=== Result ===", file=sys.stderr)
    print(f"Wrote {len(brands)} brands to {out_path}", file=sys.stderr)

    # Final stats
    has_url = sum(1 for b in brands if b.get("url"))
    has_ig = sum(1 for b in brands if b.get("instagram"))
    has_pt = sum(1 for b in brands if b.get("productType"))
    print(f"  With website URL: {has_url}", file=sys.stderr)
    print(f"  With Instagram: {has_ig}", file=sys.stderr)
    print(f"  With productType: {has_pt}", file=sys.stderr)
    print(f"  Without any URL: {sum(1 for b in brands if not b.get('url') and not b.get('instagram'))}", file=sys.stderr)


if __name__ == "__main__":
    main()
