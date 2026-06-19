#!/usr/bin/env python3
"""
Fill gaps in the enriched CSV to make all brands import-ready.

Three steps:
  1. Auto-map productTypes from brand name / context keywords
  2. Fetch meta descriptions from brand websites (concurrent)
  3. Generate template descriptions for remaining brands

Usage:
    python3 scripts/threads-scraper/fill-gaps.py

Input:  output/all-brands-merged.final.csv
Output: output/all-brands-import-ready.csv
"""

import csv
import html
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from bs4 import BeautifulSoup

OUTPUT_DIR = Path(__file__).parent / "output"
INPUT_CSV = OUTPUT_DIR / "all-brands-merged.final.csv"
OUTPUT_CSV = OUTPUT_DIR / "all-brands-import-ready.csv"

VALID_PRODUCT_TYPES = {
    "fashion", "bags-accessories", "jewelry", "beauty",
    "home", "food-drink", "crafts", "tech", "outdoor", "kids-pets",
}

# Keywords in brand name / context → productType slug
# Ordered: most specific first
NAME_CATEGORY_RULES: list[tuple[list[str], str]] = [
    # Fashion — shoes
    (["鞋", "shoe", "靴", "涼鞋", "拖鞋", "sneaker", "loafer"], "fashion"),
    # Fashion — clothing
    (["服飾", "衣", "褲", "裙", "clothing", "wear", "shirt", "dress", "牛仔",
      "外套", "大衣", "polo", "t-shirt", "apparel", "內衣", "underwear",
      "襪", "sock"], "fashion"),
    # Bags & Accessories
    (["包", "bag", "皮件", "wallet", "背包", "backpack", "手提", "側背",
      "腰包", "帽", "hat", "cap", "圍巾", "scarf", "領帶", "tie",
      "皮帶", "belt", "太陽眼鏡", "sunglasses"], "bags-accessories"),
    # Jewelry
    (["飾品", "首飾", "jewelry", "jewel", "耳環", "項鍊", "戒指", "手環",
      "手鍊", "bracelet", "necklace", "ring", "earring", "銀飾"], "jewelry"),
    # Beauty
    (["美妝", "beauty", "保養", "skincare", "化妝", "makeup", "面膜",
      "護膚", "香水", "perfume", "精油", "essential oil", "soap", "皂",
      "洗髮", "shampoo", "護髮"], "beauty"),
    # Home
    (["家具", "furniture", "居家", "home", "寢具", "bedding", "枕",
      "床", "清潔", "cleaning", "收納", "storage", "廚", "kitchen",
      "碗", "盤", "杯", "陶", "ceramic", "瓷", "玻璃", "candle", "蠟燭",
      "毛巾", "towel", "浴"], "home"),
    # Food & Drink
    (["食", "tea", "茶", "咖啡", "coffee", "醬", "sauce", "油", "醋",
      "酒", "wine", "beer", "啤", "巧克力", "chocolate", "糕", "餅",
      "麵", "noodle", "米", "rice", "honey", "蜂蜜", "果", "jam",
      "堅果", "nut", "零食", "snack", "乾", "干", "農", "farm"], "food-drink"),
    # Crafts
    (["手作", "handmade", "工藝", "craft", "皮革", "leather", "木",
      "wood", "竹", "bamboo", "編織", "weave", "knit", "文具",
      "stationery", "筆", "pen", "紙", "paper", "印刷", "print",
      "藍染", "indigo", "染", "dye"], "crafts"),
    # Tech
    (["3c", "電", "tech", "gadget", "speaker", "音響", "earphone",
      "耳機", "充電", "charger", "keyboard", "鍵盤", "滑鼠", "mouse",
      "眼鏡", "eyewear", "glasses", "光學"], "tech"),
    # Outdoor
    (["運動", "sport", "outdoor", "登山", "hiking", "camping", "露營",
      "單車", "bike", "cycling", "瑜珈", "yoga", "健身", "fitness",
      "衝浪", "surf", "潛水", "dive"], "outdoor"),
    # Kids & Pets
    (["童", "kid", "child", "baby", "嬰", "母嬰", "寵物", "pet",
      "狗", "dog", "貓", "cat"], "kids-pets"),
]

# Brand names that are clearly platforms, not product brands — skip entirely
SKIP_BRANDS = {
    "momo購物網", "cyberbiz 線上商務與線下整合開店平台", "cyberbiz",
    "pinkoi", "shopee", "蝦皮", "yahoo", "pchome",
}

# Known marketplace/platform URLs — don't fetch
SKIP_URL_DOMAINS = [
    "momoshop.com", "shopee.tw", "pchome.com", "pinkoi.com",
    "yahoo.com", "facebook.com/docs", "developers.facebook.com",
    "help.instagram", "about.meta",
]

# ZH category labels for template descriptions
CATEGORY_ZH = {
    "fashion": "時尚服飾",
    "bags-accessories": "包袋配件",
    "jewelry": "飾品珠寶",
    "beauty": "美妝保養",
    "home": "居家生活",
    "food-drink": "美食飲品",
    "crafts": "手作工藝",
    "tech": "科技產品",
    "outdoor": "戶外運動",
    "kids-pets": "親子寵物",
}


def infer_product_type(name: str, highlights: str, existing_pt: str) -> str:
    """Infer productType from brand name and context keywords."""
    if existing_pt and existing_pt in VALID_PRODUCT_TYPES:
        return existing_pt

    search_text = f"{name} {highlights}".lower()

    for keywords, slug in NAME_CATEGORY_RULES:
        for kw in keywords:
            if kw in search_text:
                return slug

    return ""


def is_junk_description(desc: str) -> bool:
    """Check if a description is junk (follower counts, single digits, etc.)."""
    if not desc or len(desc) < 40:
        return True
    d = desc.strip().lower()
    if re.match(r'^\d+[km]?\s*(followers?|following|posts?)?$', d):
        return True
    if d in ("nan", "none", "null", "undefined", "n/a"):
        return True
    return False


def should_skip_url(url: str) -> bool:
    """Check if URL is a marketplace/platform we shouldn't fetch."""
    return any(domain in url.lower() for domain in SKIP_URL_DOMAINS)


def fetch_meta_description(url: str, timeout: int = 8) -> str:
    """Fetch a URL and extract meta description or og:description."""
    if not url or should_skip_url(url):
        return ""

    try:
        resp = requests.get(
            url,
            timeout=timeout,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            },
            allow_redirects=True,
        )
        resp.raise_for_status()
    except Exception:
        return ""

    try:
        soup = BeautifulSoup(resp.text[:50000], "html.parser")
    except Exception:
        return ""

    desc = ""

    # Try meta description
    for attr in [
        {"name": "description"},
        {"property": "og:description"},
        {"name": "Description"},
        {"property": "og:Description"},
    ]:
        tag = soup.find("meta", attrs=attr)
        if tag and tag.get("content"):
            desc = tag["content"].strip()
            break

    # Fallback: title tag
    if not desc or len(desc) < 20:
        title = soup.find("title")
        if title and title.string:
            t = title.string.strip()
            if len(t) >= 20 and len(t) <= 300:
                desc = t

    if desc:
        desc = html.unescape(desc)
        desc = re.sub(r'\s+', ' ', desc).strip()
        # Truncate to 500 chars
        if len(desc) > 500:
            desc = desc[:497] + "..."

    return desc


def generate_template_description(name: str, product_type: str) -> str:
    """Generate a template description for brands still missing one."""
    cat_zh = CATEGORY_ZH.get(product_type, "生活風格")

    templates = [
        f"{name}，台灣設計製造的{cat_zh}品牌，堅持在地生產，提供高品質的台灣原創商品。",
        f"{name} 是來自台灣的{cat_zh}品牌，以台灣製造為核心，致力於提供優質的在地設計產品。",
        f"來自台灣的 {name}，專注於{cat_zh}領域，秉持台灣製造精神，打造高品質原創商品。",
    ]

    import hashlib
    idx = int(hashlib.md5(name.encode()).hexdigest(), 16) % len(templates)
    desc = templates[idx]

    if len(desc) < 40:
        desc += "台灣品牌，在地設計，品質保證。"

    return desc


def clean_brand_name(name: str) -> str:
    """Clean up brand names — remove follower counts, emoji-only names, etc."""
    # Strip leading emoji
    cleaned = re.sub(r'^[\U00010000-\U0010ffff⭐⚡✨❤️👍🏼🎓👟👗💍🛋🧹🍪💄👶🐾💊🔧📦🛒🎉🤣💡🔗💛💚💜🧡🩵🤍🩷🤎🖤❣️💕💞💓💗💖💘💝🎁🎀🌟⬇️🔻🌤️☀️]+\s*', '', name)
    # Remove (@handle) suffix
    cleaned = re.sub(r'\s*\(@[\w.]+\)\s*$', '', cleaned)
    cleaned = cleaned.strip()
    return cleaned if len(cleaned) >= 2 else name.strip()


def main():
    print("=== Fill Gaps: Making all brands import-ready ===\n", file=sys.stderr)

    with open(INPUT_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    total = len(rows)
    print(f"Loaded {total} brands from {INPUT_CSV}\n", file=sys.stderr)

    # Filter out platform/marketplace entries and junk names
    filtered = []
    skipped = 0
    for r in rows:
        name = r["name"].lower().strip()
        if name in SKIP_BRANDS:
            skipped += 1
            continue
        # Skip prose paragraphs captured as brand names
        if len(r["name"]) > 100 or len(r["name"].strip()) < 2:
            skipped += 1
            continue
        filtered.append(r)
    rows = filtered
    if skipped:
        print(f"Skipped {skipped} platform/marketplace/junk entries\n", file=sys.stderr)

    # Step 1: Clean brand names
    print("--- Step 1: Clean brand names ---", file=sys.stderr)
    name_fixes = 0
    for r in rows:
        cleaned = clean_brand_name(r["name"])
        if cleaned != r["name"]:
            name_fixes += 1
            r["name"] = cleaned
    print(f"  Fixed {name_fixes} brand names\n", file=sys.stderr)

    # Step 2: Auto-map productTypes
    print("--- Step 2: Auto-map productTypes ---", file=sys.stderr)
    pt_before = sum(1 for r in rows if r.get("productTypes", "").strip() in VALID_PRODUCT_TYPES)
    for r in rows:
        inferred = infer_product_type(
            r["name"],
            r.get("brandHighlights", ""),
            r.get("productTypes", "").strip(),
        )
        if inferred:
            r["productTypes"] = inferred
    pt_after = sum(1 for r in rows if r.get("productTypes", "").strip() in VALID_PRODUCT_TYPES)
    print(f"  Before: {pt_before} → After: {pt_after} (+{pt_after - pt_before})", file=sys.stderr)

    # For brands still without productType, set productTypeNote
    still_no_pt = 0
    for r in rows:
        if r.get("productTypes", "").strip() not in VALID_PRODUCT_TYPES:
            r["productTypeNote"] = "待分類 — 需人工審核"
            still_no_pt += 1
    print(f"  Still uncategorized (set productTypeNote): {still_no_pt}\n", file=sys.stderr)

    # Step 3: Fetch meta descriptions
    print("--- Step 3: Fetch meta descriptions ---", file=sys.stderr)
    needs_desc = [
        (i, r) for i, r in enumerate(rows)
        if is_junk_description(r.get("description", "")) and r.get("website", "").strip()
    ]
    print(f"  {len(needs_desc)} brands need description and have a URL", file=sys.stderr)
    print(f"  Fetching meta descriptions (10 concurrent workers)...", file=sys.stderr)

    fetched = 0
    failed = 0

    def fetch_one(idx_row):
        idx, r = idx_row
        url = r["website"].strip()
        desc = fetch_meta_description(url)
        return idx, desc

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(fetch_one, item): item for item in needs_desc}
        done = 0
        for future in as_completed(futures):
            done += 1
            if done % 50 == 0:
                print(f"    ... {done}/{len(needs_desc)} fetched", file=sys.stderr)
            try:
                idx, desc = future.result()
                if desc and len(desc) >= 30:
                    rows[idx]["description"] = desc
                    fetched += 1
                else:
                    failed += 1
            except Exception:
                failed += 1

    print(f"  Fetched: {fetched}, Failed/too-short: {failed}\n", file=sys.stderr)

    # Step 3b: Truncate overlong descriptions
    for r in rows:
        desc = r.get("description", "")
        if len(desc) > 500:
            r["description"] = desc[:497] + "..."

    # Step 4: Generate template descriptions for remaining gaps
    print("--- Step 4: Generate template descriptions ---", file=sys.stderr)
    still_no_desc = sum(1 for r in rows if is_junk_description(r.get("description", "")))
    print(f"  {still_no_desc} brands still need descriptions", file=sys.stderr)

    generated = 0
    for r in rows:
        if is_junk_description(r.get("description", "")):
            pt = r.get("productTypes", "").strip()
            r["description"] = generate_template_description(r["name"], pt)
            generated += 1
    print(f"  Generated {generated} template descriptions\n", file=sys.stderr)

    # Final validation
    print("=== Final Validation ===", file=sys.stderr)
    ready = 0
    issues = []
    for r in rows:
        name_ok = 2 <= len(r["name"]) <= 100
        desc_ok = 40 <= len(r.get("description", "")) <= 500
        pt_ok = (r.get("productTypes", "").strip() in VALID_PRODUCT_TYPES
                 or bool(r.get("productTypeNote", "").strip()))

        if name_ok and desc_ok and pt_ok:
            ready += 1
        else:
            issue = r["name"]
            if not name_ok:
                issue += " [bad name]"
            if not desc_ok:
                issue += f" [desc={len(r.get('description', ''))} chars]"
            if not pt_ok:
                issue += " [no productType]"
            issues.append(issue)

    print(f"  Import-ready: {ready}/{len(rows)}", file=sys.stderr)
    if issues:
        print(f"  Still have issues: {len(issues)}", file=sys.stderr)
        for iss in issues[:10]:
            print(f"    - {iss}", file=sys.stderr)

    # Write output
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n=== Done ===", file=sys.stderr)
    print(f"Wrote {len(rows)} brands to {OUTPUT_CSV}", file=sys.stderr)
    print(f"Import-ready: {ready}/{len(rows)}", file=sys.stderr)


if __name__ == "__main__":
    main()
