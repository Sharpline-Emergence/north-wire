#!/usr/bin/env python3
"""
fetch_feeds.py — Canadian News App content pipeline

What it does:
1. Reads feeds_config.json (your list of RSS sources, grouped by category)
2. Fetches every feed
3. Drops anything older than max_age_hours
4. Filters out headlines matching exclude_keywords (e.g. Trump noise)
5. De-duplicates near-identical headlines across different sources
   (this is the thing Flipboard doesn't do well)
6. Writes a clean articles.json that the PWA reads

Usage:
    python3 fetch_feeds.py                  # normal run, writes articles.json
    python3 fetch_feeds.py --check          # just test which feed URLs are alive
    python3 fetch_feeds.py --out other.json # write somewhere else

Requires: feedparser, python-dateutil  (pip install -r requirements.txt)

Run this on your own machine or a scheduled GitHub Action — NOT inside a
sandboxed environment with restricted network access, since it needs to
reach each news outlet's domain directly.
"""

import argparse
import difflib
import html
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import feedparser
except ImportError:
    print("Missing dependency. Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

from dateutil import parser as dateparser

# Some outlets block or soft-404 requests that don't look like a real browser.
# feedparser's default user agent gets flagged by a few of these — send a
# normal browser UA instead.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}


def load_config(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_published(entry) -> datetime:
    """Best-effort published time; falls back to 'now' if the feed is missing one."""
    for field in ("published", "updated", "created"):
        value = getattr(entry, field, None)
        if value:
            try:
                dt = dateparser.parse(value)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except (ValueError, TypeError):
                continue
    return datetime.now(timezone.utc)


def clean_summary(raw_summary: str, max_chars: int = 220) -> str:
    """Strip HTML tags feedparser sometimes leaves in, decode any HTML entities
    (&quot; &apos; &amp; etc. — some feeds, like Skift, send these un-decoded),
    and trim to a snippet length. Deliberately short — headline + link + short
    snippet, not full text.
    """
    import re
    text = re.sub(r"<[^>]+>", "", raw_summary or "")
    text = html.unescape(text)
    text = " ".join(text.split())
    if len(text) > max_chars:
        text = text[:max_chars].rsplit(" ", 1)[0] + "…"
    return text


def contains_excluded_keyword(title: str, summary: str, keywords: list[str]) -> bool:
    haystack = f"{title} {summary}".lower()
    return any(kw.lower() in haystack for kw in keywords)


def is_near_duplicate(title: str, seen_titles: list[str], threshold: float) -> bool:
    for seen in seen_titles:
        ratio = difflib.SequenceMatcher(None, title.lower(), seen.lower()).ratio()
        if ratio >= threshold:
            return True
    return False


def fetch_all(config: dict, check_only: bool = False) -> list[dict]:
    exclude_keywords = config.get("exclude_keywords", [])
    max_per_source = config.get("max_articles_per_source", 15)
    max_age_hours = config.get("max_age_hours", 72)
    threshold = config.get("dedup_similarity_threshold", 0.72)

    now = datetime.now(timezone.utc)
    articles = []
    seen_titles_by_category: dict[str, list[str]] = {}

    for feed_def in config["feeds"]:
        source = feed_def["source"]
        category = feed_def["category"]
        url = feed_def["url"]

        print(f"Fetching {source} ({category})... ", end="", flush=True)
        try:
            parsed = feedparser.parse(url, request_headers=BROWSER_HEADERS)
        except Exception as e:
            print(f"FAILED ({e})")
            continue

        if check_only:
            status = getattr(parsed, "status", "?")
            entry_count = len(parsed.entries)
            print(f"status={status}, entries={entry_count}")
            continue

        if getattr(parsed, "bozo", False) and not parsed.entries:
            print("FAILED (unparseable / dead feed)")
            continue

        kept = 0
        for entry in parsed.entries[: max_per_source * 2]:  # over-fetch, then filter down
            if kept >= max_per_source:
                break

            title = getattr(entry, "title", "").strip()
            title = html.unescape(title)
            link = getattr(entry, "link", "").strip()
            if not title or not link:
                continue

            published = parse_published(entry)
            age_hours = (now - published).total_seconds() / 3600
            if age_hours > max_age_hours:
                continue

            summary = clean_summary(getattr(entry, "summary", ""))

            if contains_excluded_keyword(title, summary, exclude_keywords):
                continue

            seen_titles = seen_titles_by_category.setdefault(category, [])
            if is_near_duplicate(title, seen_titles, threshold):
                continue
            seen_titles.append(title)

            articles.append({
                "title": title,
                "link": link,
                "source": source,
                "category": category,
                "summary": summary,
                "published": published.isoformat(),
            })
            kept += 1

        print(f"kept {kept}")
        time.sleep(0.3)  # be polite to source servers

    articles.sort(key=lambda a: a["published"], reverse=True)
    return articles


def main():
    parser = argparse.ArgumentParser(description="Fetch, dedupe, and filter Canadian news feeds.")
    parser.add_argument("--config", default="feeds_config.json", help="Path to feeds config JSON")
    parser.add_argument("--out", default="articles.json", help="Output path for cleaned articles")
    parser.add_argument("--check", action="store_true", help="Only test which feed URLs respond")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"Config not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    config = load_config(config_path)
    articles = fetch_all(config, check_only=args.check)

    if args.check:
        return

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "article_count": len(articles),
        "articles": articles,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {len(articles)} articles to {args.out}")


if __name__ == "__main__":
    main()
