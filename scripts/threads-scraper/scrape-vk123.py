#!/usr/bin/env python3
"""
One-time scraper for vk123.me MIT brands blog post.
Extracts brand entries and outputs Step 2 JSON format for enrich.ts.

Usage:
    python3 scripts/threads-scraper/scrape-vk123.py
"""

import json
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_FILE = OUTPUT_DIR / "vk123-mit-brands.json"

# Blog category → productTypes slug mapping
CATEGORY_MAP = {
    "鞋": "fashion",
    "shoes": "fashion",
    "服飾": "fashion",
    "clothing": "fashion",
    "underwear": "fashion",
    "內衣": "fashion",
    "包": "bags-accessories",
    "bags": "bags-accessories",
    "飾品": "jewelry",
    "accessories": "jewelry",
    "handmade": "crafts",
    "crafts": "crafts",
    "手作": "crafts",
    "工藝": "crafts",
    "家具": "home",
    "furniture": "home",
    "bedding": "home",
    "寢具": "home",
    "清潔": "home",
    "cleaning": "home",
    "household": "home",
    "居家": "home",
    "食": "food-drink",
    "food": "food-drink",
    "beverages": "food-drink",
    "飲": "food-drink",
    "茶": "food-drink",
    "美妝": "beauty",
    "beauty": "beauty",
    "skincare": "beauty",
    "保養": "beauty",
    "母嬰": "kids-pets",
    "baby": "kids-pets",
    "parenting": "kids-pets",
    "童": "kids-pets",
    "寵物": "kids-pets",
    "pets": "kids-pets",
    "健康": "outdoor",
    "health": "outdoor",
    "biotech": "outdoor",
    "生技": "outdoor",
    "運動": "outdoor",
    "sports": "outdoor",
    "3c": "tech",
    "eyewear": "tech",
    "電": "tech",
    "文具": "crafts",
    "stationery": "crafts",
    "packaging": "crafts",
}

# Skip these categories (not actual product brands)
SKIP_CATEGORIES = {"curation", "retail", "選品", "平台", "物流", "logistics",
                   "怎麼來", "notebooklm", "notebook", "不想一個一個找", "教你",
                   "更新歷程", "留言", "回應", "akismet"}


def guess_product_type(category_text: str) -> str:
    """Map a blog section heading to a productTypes slug."""
    lower = category_text.lower()
    for keyword, slug in CATEGORY_MAP.items():
        if keyword in lower:
            return slug
    return ""


def should_skip_category(category_text: str) -> bool:
    lower = category_text.lower()
    return any(kw in lower for kw in SKIP_CATEGORIES)


def extract_ig_url(handle: str) -> str:
    """Convert @handle to Instagram URL."""
    clean = handle.strip().lstrip("@")
    if clean:
        return f"https://www.instagram.com/{clean}/"
    return ""


def parse_brand_line(text: str, current_category: str, product_type: str) -> dict | None:
    """Parse a single brand entry line into a brand dict."""
    if not text.strip():
        return None

    # Try to extract: name, IG handle, description
    # Common patterns:
    #   "Brand Name @handle — description"
    #   "Brand Name | @handle | description"
    #   "Brand Name (@handle) description"

    name = ""
    instagram = ""
    url = ""
    context = current_category

    # Extract URLs
    url_match = re.search(r'https?://[^\s,，]+', text)
    if url_match:
        url = url_match.group(0).rstrip(')')

    # Extract IG handle
    ig_match = re.search(r'@([a-zA-Z0-9_.]+)', text)
    if ig_match:
        instagram = extract_ig_url(ig_match.group(1))

    # Extract brand name — usually the bolded text or first part before separator
    # Remove URL and IG handle to get cleaner name
    cleaned = text
    if url_match:
        cleaned = cleaned.replace(url_match.group(0), "")
    if ig_match:
        cleaned = cleaned.replace(ig_match.group(0), "")

    # Split on common separators
    parts = re.split(r'[|｜—–·]', cleaned, maxsplit=1)
    name = parts[0].strip()

    # Clean up name: remove numbering, asterisks, emoji
    name = re.sub(r'^\d+\.\s*', '', name)
    name = re.sub(r'\*+', '', name)
    # Strip all emoji
    name = re.sub(r'[\U00010000-\U0010ffff⭐⚡✨❤️👍🏼🎓👟👗💍🛋🧹🍪💄👶🐾💊🔧📦🛒🎉🤣💡🔗💛💚💜🧡🩵🤍🩷🤎🖤❣️💕💞💓💗💖💘💝🎁🎀🌟⬇️🔻]+', '', name)
    name = name.strip()

    if not name or len(name) < 2:
        return None

    # Skip entries that are clearly prose paragraphs, not brand names
    if len(name) > 60:
        return None
    if any(kw in name for kw in ["步驟", "第一步", "第二步", "第三步", "打開", "登入", "建立", "怎麼來", "教你", "超簡單"]):
        return None

    entry = {"name": name, "context": context}
    if url:
        entry["url"] = url
    if instagram:
        entry["instagram"] = instagram

    if product_type:
        entry["productType"] = product_type

    return entry


def scrape_blog():
    """Fetch and parse the vk123 MIT brands blog post."""
    blog_url = "https://www.vk123.me/life/taiwan-mit-brands/"
    print(f"Fetching {blog_url}...", file=sys.stderr)

    resp = requests.get(blog_url, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    })
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Find the main content area
    content = soup.find("article") or soup.find("div", class_="entry-content") or soup.find("main")
    if not content:
        content = soup.body

    brands = []
    current_category = ""
    current_product_type = ""
    seen_names = set()

    # Walk through all elements looking for headings (categories) and list items (brands)
    for el in content.find_all(["h2", "h3", "h4", "li", "p", "strong"]):
        tag = el.name

        # Category headings
        if tag in ("h2", "h3", "h4"):
            heading_text = el.get_text(strip=True)
            if should_skip_category(heading_text):
                current_category = ""
                current_product_type = ""
                continue
            current_category = heading_text
            current_product_type = guess_product_type(heading_text)
            continue

        if not current_category:
            continue

        # Brand entries — usually in <li> or <p> tags
        text = el.get_text(strip=True)
        if not text or len(text) < 3:
            continue

        # Look for links in this element
        links = el.find_all("a", href=True)
        link_url = ""
        for link in links:
            href = link["href"]
            if "instagram.com" in href or "facebook.com" in href or "pinkoi.com" in href:
                link_url = href
            elif href.startswith("http") and "vk123" not in href:
                link_url = href

        brand = parse_brand_line(text, current_category, current_product_type)
        if brand:
            if link_url and "url" not in brand:
                brand["url"] = link_url
            # Dedup by name
            norm_name = brand["name"].lower().strip()
            if norm_name not in seen_names:
                seen_names.add(norm_name)
                brands.append(brand)

    return brands


def main():
    try:
        brands = scrape_blog()
    except Exception as e:
        print(f"Failed to scrape blog: {e}", file=sys.stderr)
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(brands, f, ensure_ascii=False, indent=2)

    print(f"\nExtracted {len(brands)} brands to {OUTPUT_FILE}", file=sys.stderr)

    # Summary by product type
    by_type: dict[str, int] = {}
    no_url = 0
    for b in brands:
        pt = b.get("productType", "(unmapped)")
        by_type[pt] = by_type.get(pt, 0) + 1
        if "url" not in b and "instagram" not in b:
            no_url += 1

    print("\nBy productType:", file=sys.stderr)
    for pt, count in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {pt}: {count}", file=sys.stderr)
    print(f"\n{no_url} brands with no URL or Instagram", file=sys.stderr)


if __name__ == "__main__":
    main()
