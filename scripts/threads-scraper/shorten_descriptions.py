#!/usr/bin/env python3
"""Shorten brand descriptions in the CSV to fit the 300-character limit.

Steps:
1. Strip Pinkoi boilerplate prefix if present
2. If still over 300 chars, truncate at the last natural break point before 295
3. Verify all descriptions are <= 300 chars
"""

import csv
import re
import sys

CSV_PATH = "/Users/ytchou/project/mitmap/scripts/threads-scraper/output/taiwan-brands-2026-06-17-brands.final.csv"
MAX_LEN = 300

# Pinkoi boilerplate pattern:
# {anything}官方經營商店，Pinkoi 新會員享 APP 運費優惠，最高折 NT$100！
PINKOI_BOILERPLATE_RE = re.compile(
    r'^.*?官方經營商店，Pinkoi\s*新會員享\s*APP\s*運費優惠，最高折\s*NT\$?\d+！'
)

# Additional boilerplate that may appear at the start after stripping
BOILERPLATE_PREFIXES = [
    re.compile(r'^Since\s+\d{4}[｜|]'),  # "Since 2024｜" year markers
]

# Natural break characters for Chinese text
BREAK_CHARS = set('。！；，、）」』】）\n')

# Promotional / emoji trailing patterns to strip
TRAILING_JUNK_RE = re.compile(r'[\s\U0001F3C5\U0001F4E6\U0001F381\U0001F31F⭐🏅📍✨💛💚❤️🔥🎉🎊🎁]+$')


def strip_pinkoi_boilerplate(desc: str) -> str:
    """Remove Pinkoi store boilerplate prefix."""
    m = PINKOI_BOILERPLATE_RE.match(desc)
    if m:
        return desc[m.end():].lstrip()
    return desc


def truncate_description(desc: str) -> str:
    """Truncate description to MAX_LEN chars at a natural break point."""
    if len(desc) <= MAX_LEN:
        return desc

    # Look for the last natural break point before position 295
    search_window = desc[:295]
    last_break = -1
    for i, ch in enumerate(search_window):
        if ch in BREAK_CHARS:
            last_break = i

    if last_break > 100:
        # Cut after the break character (include it)
        result = desc[:last_break + 1].rstrip()
    else:
        # No good break point found; hard cut at 290 and add ellipsis
        result = desc[:290].rstrip() + '…'

    return result


def clean_description(desc: str) -> str:
    """Full cleaning pipeline for a description."""
    # Step 1: Strip Pinkoi boilerplate
    desc = strip_pinkoi_boilerplate(desc)

    # Step 2: Strip leading/trailing whitespace
    desc = desc.strip()

    # Step 3: Strip trailing emoji/promo junk
    desc = TRAILING_JUNK_RE.sub('', desc).rstrip()

    # Step 4: Truncate if still over limit
    desc = truncate_description(desc)

    return desc


def main():
    csv.field_size_limit(sys.maxsize)

    # Read all rows
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    if not fieldnames:
        print("ERROR: Could not read CSV fieldnames")
        sys.exit(1)

    # Process descriptions
    shortened_count = 0
    still_over = 0

    for row in rows:
        original = row.get('description', '')
        if len(original) > MAX_LEN:
            cleaned = clean_description(original)
            row['description'] = cleaned
            shortened_count += 1

            if len(cleaned) > MAX_LEN:
                still_over += 1
                print(f"  STILL OVER: {row.get('name', '?')} -> {len(cleaned)} chars")
                print(f"    [{cleaned[:100]}...]")

    # Write back
    with open(CSV_PATH, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    # Final verification pass
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        max_found = 0
        over_count = 0
        for row in reader:
            desc_len = len(row.get('description', ''))
            if desc_len > max_found:
                max_found = desc_len
            if desc_len > MAX_LEN:
                over_count += 1

    print(f"\nResults:")
    print(f"  Descriptions shortened: {shortened_count}")
    print(f"  Still over {MAX_LEN} chars after processing: {still_over}")
    print(f"  Max description length in output: {max_found}")
    print(f"  Verification - rows over {MAX_LEN}: {over_count}")

    if over_count > 0:
        print("\nWARNING: Some descriptions still exceed the limit!")
        sys.exit(1)
    else:
        print("\nAll descriptions are within the 300-character limit.")


if __name__ == '__main__':
    main()
