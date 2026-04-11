#!/usr/bin/env python3
"""
Fix hymns in the SQLite database that only have 1 section but should have multiple stanzas.

The issue: many old-format .ppt files have all stanzas crammed into a single slide
as separate text blocks. The import parser only captured the first stanza.

This script:
1. Reads the raw JSON extracted from the PPT/PPTX files
2. Finds hymns with exactly 1 section in the DB
3. Checks if the raw data has multiple stanza text blocks
4. Updates the database with the correct stanzas
"""

import json
import os
import re
import sqlite3
import sys

# ── Paths ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_JSON_PATH = os.path.join(SCRIPT_DIR, "all_hymns_raw.json")
DB_PATH = os.path.expanduser("~/Library/Application Support/adventshow/hymns.db")

# ── Helpers ────────────────────────────────────────────────────────────────────


def normalize_for_dedup(text: str) -> str:
    """Normalize whitespace for deduplication comparison."""
    t = text.replace("\x0b", "\n")
    lines = t.split("\n")
    normalized_lines = []
    for line in lines:
        normalized = re.sub(r"[\t ]+", " ", line).strip()
        normalized_lines.append(normalized)
    return "\n".join(normalized_lines).strip()


def is_title_block(tb: str, hymn_num: str) -> bool:
    """
    Check if a text block is a title/header rather than an actual stanza.
    Title blocks typically:
      - Start with the hymn number (e.g. "48. Măriţi pe Domnul...")
      - Are relatively short (< 50 chars when VT replaced with space)
    """
    hymn_int = int(hymn_num)
    text_clean = tb.replace("\x0b", " ").strip()

    if len(text_clean) < 50:
        m = re.match(r"^(\d+)\.?\s", text_clean)
        if m:
            num = int(m.group(1))
            # Allow ±2 tolerance for mismatched numbers (e.g., "149." for hymn 150)
            if abs(num - hymn_int) <= 2:
                return True
            # Numbers > 10 that appear in short blocks are almost certainly title refs
            if num > 10:
                return True
    return False


def is_ppt_junk(tb: str) -> bool:
    """Check if the text block is PPT template junk."""
    if "Click to edit" in tb:
        return True
    if "\r" in tb:
        return True
    if tb.strip() == "*":
        return True
    return False


def extract_stanzas(hymn_num: str, raw: dict) -> list[str]:
    """
    Extract actual stanza texts from raw PPT data.
    Returns a list of cleaned, deduplicated stanza strings.
    """
    slides = raw.get("slides", [])
    candidates = []

    for slide in slides:
        for tb in slide:
            if is_ppt_junk(tb):
                continue
            # Must have vertical tab (line separator within stanza)
            if "\x0b" not in tb:
                continue
            if is_title_block(tb, hymn_num):
                continue
            candidates.append(tb)

    # Deduplicate (some slides have the same stanza repeated)
    seen = set()
    unique = []
    for s in candidates:
        norm = normalize_for_dedup(s)
        if norm not in seen:
            seen.add(norm)
            unique.append(s)

    return unique


def clean_stanza_text(text: str) -> str:
    """
    Clean raw stanza text for database storage:
      - Replace vertical tabs with newlines
      - Strip leading stanza numbers (e.g. "1.  ", "2. ")
      - Clean up excessive tabs/spaces within lines
      - Strip trailing whitespace per line
    """
    # Replace VT with newline
    cleaned = text.replace("\x0b", "\n")

    # Strip leading stanza number from first line (e.g., "1.    Text..." → "Text...")
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)

    # Clean up each line
    lines = cleaned.split("\n")
    cleaned_lines = []
    for line in lines:
        # Replace tabs with spaces and collapse multiple spaces
        line = line.replace("\t", " ")
        line = re.sub(r"  +", " ", line)
        line = line.strip()
        cleaned_lines.append(line)

    # Remove leading/trailing empty lines
    while cleaned_lines and not cleaned_lines[0]:
        cleaned_lines.pop(0)
    while cleaned_lines and not cleaned_lines[-1]:
        cleaned_lines.pop()

    return "\n".join(cleaned_lines)


# ── Main ───────────────────────────────────────────────────────────────────────


def main():
    # Load raw data
    if not os.path.exists(RAW_JSON_PATH):
        print(f"ERROR: Raw JSON file not found: {RAW_JSON_PATH}")
        sys.exit(1)

    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found: {DB_PATH}")
        sys.exit(1)

    print(f"Loading raw hymn data from: {RAW_JSON_PATH}")
    with open(RAW_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    raw_hymns = data["hymns"]
    print(f"  Loaded {len(raw_hymns)} hymns from raw JSON\n")

    # Connect to database
    print(f"Connecting to database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    c = conn.cursor()

    # Get category ID for "Imnuri Creștine"
    c.execute("SELECT id FROM categories WHERE name='Imnuri Creștine'")
    row = c.fetchone()
    if not row:
        print("ERROR: Category 'Imnuri Creștine' not found!")
        sys.exit(1)
    category_id = row[0]

    # Find hymns with exactly 1 section
    c.execute(
        """
        SELECT h.id, h.number, h.title, COUNT(hs.id) as section_count
        FROM hymns h
        LEFT JOIN hymn_sections hs ON hs.hymn_id = h.id
        WHERE h.category_id = ?
        GROUP BY h.id
        HAVING section_count = 1
    """,
        (category_id,),
    )
    single_section_hymns = c.fetchall()
    print(f"  Found {len(single_section_hymns)} hymns with exactly 1 section\n")

    # Analyze each single-section hymn
    fixed_count = 0
    skipped_count = 0
    errors = []

    print("=" * 70)
    print("ANALYZING SINGLE-SECTION HYMNS")
    print("=" * 70)

    for hymn_id, hymn_num, hymn_title, _ in single_section_hymns:
        raw = raw_hymns.get(hymn_num)
        if not raw:
            continue

        stanzas = extract_stanzas(hymn_num, raw)

        if len(stanzas) <= 1:
            # Genuinely single stanza (canon, doxology, etc.) — leave alone
            skipped_count += 1
            continue

        # This hymn needs fixing!
        print(f"\n{'─' * 60}")
        print(f"FIXING: Hymn {hymn_num} — {hymn_title}")
        print(f"  Currently: 1 section in DB")
        print(f"  Found: {len(stanzas)} stanzas in raw data")

        # Show what we'll insert
        cleaned_stanzas = []
        for i, raw_text in enumerate(stanzas):
            cleaned = clean_stanza_text(raw_text)
            cleaned_stanzas.append(cleaned)
            preview_lines = cleaned.split("\n")
            preview = preview_lines[0][:60]
            print(f"  Stanza {i + 1}: {preview}...")

        # Execute the fix
        try:
            # Delete existing section(s)
            c.execute("DELETE FROM hymn_sections WHERE hymn_id = ?", (hymn_id,))
            deleted = c.rowcount
            print(f"  Deleted {deleted} existing section(s)")

            # Insert new stanzas
            for idx, text in enumerate(cleaned_stanzas):
                c.execute(
                    """
                    INSERT INTO hymn_sections (hymn_id, order_index, type, text)
                    VALUES (?, ?, 'strofa', ?)
                """,
                    (hymn_id, idx, text),
                )

            print(f"  Inserted {len(cleaned_stanzas)} new sections")
            fixed_count += 1

        except Exception as e:
            error_msg = f"ERROR fixing hymn {hymn_num}: {e}"
            print(f"  {error_msg}")
            errors.append(error_msg)

    # Commit all changes
    conn.commit()

    # Verify the fixes
    print(f"\n{'=' * 70}")
    print("VERIFICATION")
    print("=" * 70)

    for hymn_id, hymn_num, hymn_title, _ in single_section_hymns:
        raw = raw_hymns.get(hymn_num)
        if not raw:
            continue
        stanzas = extract_stanzas(hymn_num, raw)
        if len(stanzas) <= 1:
            continue

        c.execute(
            "SELECT order_index, type, substr(text, 1, 60) FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index",
            (hymn_id,),
        )
        sections = c.fetchall()
        print(f"\n  Hymn {hymn_num} ({hymn_title}) — now has {len(sections)} sections:")
        for order_idx, stype, text_preview in sections:
            print(f"    [{order_idx}] {stype}: {text_preview}")

    conn.close()

    # Summary
    print(f"\n{'=' * 70}")
    print("SUMMARY")
    print("=" * 70)
    print(f"  Hymns analyzed (single-section): {len(single_section_hymns)}")
    print(f"  Hymns fixed: {fixed_count}")
    print(f"  Hymns skipped (genuinely single stanza): {skipped_count}")
    print(f"  Errors: {len(errors)}")
    if errors:
        for e in errors:
            print(f"    - {e}")
    print()


if __name__ == "__main__":
    main()
