#!/usr/bin/env python3
"""
Threads Reply Scraper — extracts replies from a public Threads post.

Usage:
    # First time: log in and save session (opens real browser)
    python scrape.py login

    # Scrape replies from a post
    python scrape.py scrape <threads-url> --name mit-backpacks

    # Scrape without saved session (public posts only)
    python scrape.py scrape <threads-url> --name mit-backpacks --no-auth

Output:
    Writes JSON to stdout and saves to threads-scraper/output/{username}-{name}-{date}.json
"""

import json
import re
import sys
import time
import csv
import io
import random
from pathlib import Path
from datetime import datetime, timezone

from nested_lookup import nested_lookup
from playwright.sync_api import sync_playwright, Page

SCRIPT_DIR = Path(__file__).parent
STATE_FILE = SCRIPT_DIR / "auth-state.json"
OUTPUT_DIR = SCRIPT_DIR / "output"

# Human-like delays (seconds)
SCROLL_DELAY_MIN = 2.5
SCROLL_DELAY_MAX = 5.0
PAGE_LOAD_WAIT = 4.0
POST_NAVIGATE_WAIT = 3.0


def human_delay(min_s=SCROLL_DELAY_MIN, max_s=SCROLL_DELAY_MAX):
    time.sleep(random.uniform(min_s, max_s))


def extract_post_id(url: str) -> str:
    """Extract the post short-code from a Threads URL."""
    match = re.search(r"/post/([A-Za-z0-9_-]+)", url)
    if match:
        return match.group(1)
    return url.rstrip("/").split("/")[-1].split("?")[0]


def extract_username(url: str) -> str:
    """Extract the @username from a Threads URL."""
    match = re.search(r"/@?([A-Za-z0-9_.]+)/post/", url)
    return match.group(1) if match else "unknown"


def build_output_filename(url: str, name: str | None) -> str:
    """Build descriptive filename: {username}-{name}-{date}.json"""
    username = extract_username(url)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if name:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        return f"{username}-{slug}-{date_str}"
    return f"{username}-{date_str}"


def parse_thread_item(item: dict) -> dict | None:
    """Parse a single thread_item into a structured reply dict."""
    post = item.get("post")
    if not post:
        return None

    caption = post.get("caption") or {}
    user = post.get("user") or {}
    text_info = post.get("text_post_app_info") or {}

    return {
        "username": user.get("username", ""),
        "user_id": user.get("pk", ""),
        "text": caption.get("text", ""),
        "like_count": post.get("like_count", 0),
        "reply_count": text_info.get("direct_reply_count", 0),
        "taken_at": post.get("taken_at", 0),
        "taken_at_iso": (
            datetime.fromtimestamp(post.get("taken_at", 0), tz=timezone.utc).isoformat()
            if post.get("taken_at")
            else ""
        ),
        "id": post.get("pk", ""),
    }


def extract_replies_from_html(html: str) -> dict:
    """Extract thread data from embedded JSON in the HTML."""
    results = {
        "main_post": None,
        "replies": [],
        "raw_reply_count": 0,
    }

    script_pattern = re.compile(
        r'<script[^>]*type="application/json"[^>]*data-sjs[^>]*>(.*?)</script>',
        re.DOTALL,
    )

    all_thread_items = []

    for match in script_pattern.finditer(html):
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue

        items = nested_lookup("thread_items", data)
        for item_list in items:
            if isinstance(item_list, list):
                all_thread_items.extend(item_list)

    seen_ids = set()
    for item in all_thread_items:
        parsed = parse_thread_item(item)
        if not parsed or not parsed["text"]:
            continue
        if parsed["id"] in seen_ids:
            continue
        seen_ids.add(parsed["id"])

        if results["main_post"] is None:
            results["main_post"] = parsed
        else:
            results["replies"].append(parsed)

    results["raw_reply_count"] = len(results["replies"])
    return results


def switch_reply_sort(page: Page) -> bool:
    """Try to switch the reply sort from 'Top' to 'All' or 'Latest'."""
    # The sort toggle is a clickable area with text "Top" or "熱門" near the replies
    try:
        # Click the sort toggle — try multiple selectors
        sort_clicked = False
        for selector in [
            'text="Top"',
            'text="熱門"',
            ':text-is("Top")',
            ':text-is("熱門")',
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.click(timeout=3000)
                    sort_clicked = True
                    print("  Clicked sort toggle", file=sys.stderr)
                    human_delay(1.0, 2.0)
                    break
            except Exception:
                continue

        if not sort_clicked:
            print("  Could not find sort toggle — using default sort", file=sys.stderr)
            return False

        # Look for sort options in the opened dropdown/menu
        for option_text in ["Recent", "最新", "All", "全部", "Latest"]:
            try:
                option = page.locator(f'text="{option_text}"').first
                if option.is_visible(timeout=1500):
                    option.click(timeout=3000)
                    print(f"  Switched sort to '{option_text}'", file=sys.stderr)
                    human_delay(2.0, 4.0)
                    return True
            except Exception:
                continue

        # Dropdown opened but no matching option — dismiss
        page.keyboard.press("Escape")
        human_delay(0.5, 1.0)
        print("  Sort dropdown opened but no 'All'/'Latest' option found", file=sys.stderr)
        return False

    except Exception as e:
        print(f"  Sort switch failed: {e}", file=sys.stderr)
        return False


def scroll_to_load_replies(page: Page, max_scrolls: int = 80) -> None:
    """Scroll the page and click 'load more' buttons to get all replies."""
    prev_height = 0
    no_change_count = 0

    for i in range(max_scrolls):
        # Try clicking "View more replies" / "Show replies" style buttons
        try:
            load_more = page.locator(
                'div[role="button"]:has-text("View"), '
                'div[role="button"]:has-text("replies"), '
                'div[role="button"]:has-text("顯示"), '
                'div[role="button"]:has-text("查看"), '
                'div[role="button"]:has-text("更多")'
            )
            if load_more.count() > 0:
                for btn_idx in range(min(load_more.count(), 3)):
                    try:
                        load_more.nth(btn_idx).click(timeout=2000)
                        human_delay(1.0, 2.0)
                    except Exception:
                        pass
        except Exception:
            pass

        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        human_delay()

        curr_height = page.evaluate("document.body.scrollHeight")
        if curr_height == prev_height:
            no_change_count += 1
            if no_change_count >= 4:
                break
        else:
            no_change_count = 0
        prev_height = curr_height

        if (i + 1) % 10 == 0:
            print(f"  ... scrolled {i + 1} times, page height: {curr_height}", file=sys.stderr)


def scrape_with_network_capture(page: Page, url: str) -> list[dict]:
    """Capture API responses that contain thread reply data."""
    captured_items = []

    def handle_response(response):
        if "thread_items" not in response.url and "/api/v1/" not in response.url:
            return
        try:
            data = response.json()
            items = nested_lookup("thread_items", data)
            for item_list in items:
                if isinstance(item_list, list):
                    captured_items.extend(item_list)
        except Exception:
            pass

    page.on("response", handle_response)
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(int(PAGE_LOAD_WAIT * 1000))

    # Try switching from "Top" to "Recent" before scrolling
    switch_reply_sort(page)
    scroll_to_load_replies(page)

    return captured_items


def do_login():
    """Open a browser for manual login, then save session state."""
    print("Opening browser for Threads login...", file=sys.stderr)
    print("Log in to your Threads account, then press Enter in this terminal.", file=sys.stderr)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.goto("https://www.threads.net/login")

        input("\n>>> Press Enter after you've logged in successfully... ")

        context.storage_state(path=str(STATE_FILE))
        print(f"Session saved to {STATE_FILE}", file=sys.stderr)
        browser.close()


def _run_single_pass(pw, url: str, storage_state: str | None, label: str):
    """Run one scrape pass (network capture + HTML extraction) and return raw items."""
    browser = pw.chromium.launch(headless=True)
    ctx_opts = {
        "viewport": {"width": 1280, "height": 900},
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
    }
    if storage_state:
        ctx_opts["storage_state"] = storage_state

    context = browser.new_context(**ctx_opts)
    page = context.new_page()

    print(f"  [{label}] Capturing network responses...", file=sys.stderr)
    network_items = scrape_with_network_capture(page, url)

    print(f"  [{label}] Extracting embedded JSON...", file=sys.stderr)
    html = page.content()
    html_results = extract_replies_from_html(html)

    browser.close()
    return network_items, html_results


def do_scrape(url: str, use_auth: bool = True, name: str | None = None):
    """Scrape replies from a Threads post URL."""
    post_id = extract_post_id(url)
    print(f"Scraping post: {post_id}", file=sys.stderr)
    print(f"URL: {url}", file=sys.stderr)

    has_auth = use_auth and STATE_FILE.exists()

    all_network_items = []
    all_html_results_list = []

    with sync_playwright() as p:
        # Pass 1: always run unauthenticated (tends to return more replies)
        print("Pass 1: Unauthenticated scrape...", file=sys.stderr)
        net1, html1 = _run_single_pass(p, url, None, "no-auth")
        all_network_items.extend(net1)
        all_html_results_list.append(html1)

        # Pass 2: if we have auth, run authenticated too (may get different replies)
        if has_auth:
            print("Pass 2: Authenticated scrape...", file=sys.stderr)
            human_delay(3.0, 5.0)
            net2, html2 = _run_single_pass(p, url, str(STATE_FILE), "auth")
            all_network_items.extend(net2)
            all_html_results_list.append(html2)
        else:
            print("No saved session — skipping authenticated pass.", file=sys.stderr)

    # Use first pass with a main_post as the source
    html_results = all_html_results_list[0]
    for hr in all_html_results_list[1:]:
        if hr["main_post"] and not html_results["main_post"]:
            html_results["main_post"] = hr["main_post"]
        html_results["replies"].extend(hr["replies"])

    # Merge results from both strategies
    seen_ids = set()
    all_replies = []

    if html_results["main_post"]:
        main_post = html_results["main_post"]
    else:
        main_post = None

    # Add HTML-extracted replies first (these include the initial load)
    for reply in html_results["replies"]:
        if reply["id"] not in seen_ids:
            seen_ids.add(reply["id"])
            all_replies.append(reply)

    # Add network-captured replies (these include scroll-loaded ones)
    for item in all_network_items:
        parsed = parse_thread_item(item)
        if parsed and parsed["text"] and parsed["id"] not in seen_ids:
            seen_ids.add(parsed["id"])
            if main_post is None:
                main_post = parsed
            else:
                all_replies.append(parsed)

    output = {
        "url": url,
        "post_id": post_id,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "main_post": main_post,
        "reply_count": len(all_replies),
        "replies": sorted(all_replies, key=lambda r: r.get("like_count", 0), reverse=True),
    }

    # Save to file
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = build_output_filename(url, name)
    out_path = OUTPUT_DIR / f"{filename}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\nSaved {len(all_replies)} replies to {out_path}", file=sys.stderr)

    # Also write to stdout
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return output


def do_to_csv(json_path: str):
    """Convert a scraped JSON output to a CSV matching the bulk import format."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "source_url",
        "post_id",
        "reply_username",
        "reply_text",
        "like_count",
        "reply_count",
        "timestamp",
    ])

    for reply in data.get("replies", []):
        writer.writerow([
            data["url"],
            data["post_id"],
            reply["username"],
            reply["text"],
            reply["like_count"],
            reply["reply_count"],
            reply["taken_at_iso"],
        ])

    csv_path = Path(json_path).with_suffix(".csv")
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write(buf.getvalue())

    print(f"Wrote {len(data.get('replies', []))} replies to {csv_path}", file=sys.stderr)


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "login":
        do_login()

    elif cmd == "scrape":
        if len(sys.argv) < 3:
            print("Usage: python scrape.py scrape <threads-url> --name <topic> [--no-auth]", file=sys.stderr)
            sys.exit(1)
        url = sys.argv[2]
        use_auth = "--no-auth" not in sys.argv
        name = None
        if "--name" in sys.argv:
            name_idx = sys.argv.index("--name")
            if name_idx + 1 < len(sys.argv):
                name = sys.argv[name_idx + 1]
        do_scrape(url, use_auth=use_auth, name=name)

    elif cmd == "to-csv":
        if len(sys.argv) < 3:
            print("Usage: python scrape.py to-csv <output.json>", file=sys.stderr)
            sys.exit(1)
        do_to_csv(sys.argv[2])

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print(__doc__, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
