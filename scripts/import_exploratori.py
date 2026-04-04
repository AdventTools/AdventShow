#!/usr/bin/env python3
"""
Import Exploratori hymns from raw JSON into hymns.db.

Usage:
  python3 import_exploratori.py          # dry run - shows parsed hymns
  python3 import_exploratori.py --import  # actually import into DB
"""

import json
import re
import sqlite3
import sys
import os
import unicodedata

RAW_JSON = os.path.join(os.path.dirname(__file__), "exploratori_raw.json")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "hymns.db")
CATEGORY_NAME = "Exploratori"

# Files to skip entirely
SKIP_FILES = {
    "Index EXPLORATORI.pptx",  # just an index, not a hymn
}


def normalize_title(title: str) -> str:
    """Convert a title to proper case (capitalize first letter of each sentence/word start).
    
    Handles Romanian characters properly.
    """
    # If already mixed case, keep it
    if title != title.upper() and title != title.lower():
        return title
    
    # Title case conversion for ALL-CAPS titles
    words = title.split()
    result = []
    for i, w in enumerate(words):
        if len(w) <= 2 and w.upper() in ("ŞI", "SI", "LA", "DE", "PE", "CU", "IN", "ÎN", "E", "O", "A"):
            # Lowercase small words (unless first word)
            if i == 0:
                result.append(w[0].upper() + w[1:].lower() if len(w) > 1 else w.upper())
            else:
                result.append(w.lower())
        else:
            # Capitalize first letter, lowercase rest
            result.append(w[0].upper() + w[1:].lower() if len(w) > 1 else w.upper())
    
    return " ".join(result)


def strip_stanza_number(text: str) -> str:
    """Remove leading stanza number like '1. ' or '2.  ' from text."""
    return re.sub(r"^\d+\.\s*", "", text)


def parse_hymn(fname: str, hymn_data: dict) -> dict | None:
    """Parse a single exploratori hymn from raw JSON data."""
    if fname in SKIP_FILES:
        return None
    
    slides = hymn_data.get("slides", [])
    
    # Extract number and title from filename (more reliable than slide content)
    m = re.match(r"(\d+)\s*\.?\s+(.+)\.(ppt|pptx)$", fname, re.I)
    if not m:
        m = re.match(r"(\d+)\s+(.+)\.(ppt|pptx)$", fname, re.I)
    if not m:
        print(f"  WARNING: cannot parse filename: {fname}")
        return None
    
    number = str(int(m.group(1)))  # strip leading zeros
    title_from_filename = m.group(2).strip()
    
    # Check CenterTitle from slide 0 for a potentially better title
    title = title_from_filename  # default: from filename
    if slides and slides[0]:
        center_title = next((b for b in slides[0] if b["type"] == "CenterTitle"), None)
        if center_title:
            ct = center_title["text"]
            # Remove leading "NNN. " prefix
            ct_clean = re.sub(r"^\d+\.?\s*", "", ct).strip()
            if ct_clean:
                # CenterTitle is usually ALL CAPS, filename has better casing
                # But if CenterTitle has mixed case, prefer it
                if ct_clean != ct_clean.upper():
                    title = ct_clean
    
    # Normalize title casing
    title = normalize_title(title)
    
    # Parse sections from content slides (skip slide 0 = title slide)
    sections = []
    has_content = False
    
    for slide_idx in range(1, len(slides)):
        slide = slides[slide_idx]
        if not slide:
            continue
        
        # Each content slide has exactly 1 text block (Title type)
        for block in slide:
            text = block.get("text", "").strip()
            if not text:
                continue
            has_content = True
            
            # Check if this is a refrain (starts with "Refren:" or "Refren :")
            refren_match = re.match(r"^Refren\s*:\s*\n?(.+)", text, re.I | re.DOTALL)
            if refren_match:
                refren_text = refren_match.group(1).strip()
                if refren_text:
                    sections.append({"type": "refren", "text": refren_text})
                continue
            
            # Otherwise it's a stanza - strip leading number
            stanza_text = strip_stanza_number(text)
            if stanza_text:
                sections.append({"type": "strofa", "text": stanza_text})
    
    if not has_content or not sections:
        print(f"  WARNING: no content for {fname} (number={number})")
        return None
    
    # Deduplicate consecutive refrains (they repeat between stanzas)
    deduped = []
    refrain_text = None
    for sec in sections:
        if sec["type"] == "refren":
            if refrain_text is None:
                refrain_text = sec["text"]
                deduped.append(sec)
            # Skip duplicate refrains
        else:
            deduped.append(sec)
    
    # Rebuild with only unique sections (strofas + single refrain)
    stanzas = [s for s in deduped if s["type"] == "strofa"]
    refrain = refrain_text
    
    return {
        "number": number,
        "title": title,
        "stanzas": stanzas,
        "refrain": refrain,
    }


def build_sections(stanzas: list, refrain: str | None) -> list:
    """Build final section list with alternating strofa/refren pattern."""
    result = []
    for s in stanzas:
        result.append({"type": "strofa", "text": s["text"]})
        if refrain:
            result.append({"type": "refren", "text": refrain})
    return result


def make_search_text(number: str, title: str, sections: list) -> str:
    """Create normalized search text."""
    raw = f"{number} {title} " + " ".join(s["text"] for s in sections)
    # Normalize diacritics
    nfkd = unicodedata.normalize("NFD", raw)
    no_diacritics = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    return no_diacritics.lower()


def import_to_db(hymns: list[dict], db_path: str):
    """Import parsed hymns into the database."""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    # Get or create Exploratori category
    cur.execute("SELECT id FROM categories WHERE name = ?", (CATEGORY_NAME,))
    row = cur.fetchone()
    if row:
        cat_id = row[0]
    else:
        cur.execute("INSERT INTO categories (name) VALUES (?)", (CATEGORY_NAME,))
        cat_id = cur.lastrowid
    
    # Delete existing Exploratori hymns
    cur.execute("SELECT id FROM hymns WHERE category_id = ?", (cat_id,))
    existing_ids = [r[0] for r in cur.fetchall()]
    if existing_ids:
        cur.execute(f"DELETE FROM hymn_sections WHERE hymn_id IN ({','.join('?' * len(existing_ids))})", existing_ids)
        cur.execute(f"DELETE FROM hymns WHERE id IN ({','.join('?' * len(existing_ids))})", existing_ids)
        print(f"  Deleted {len(existing_ids)} existing Exploratori hymns")
    
    # Insert hymns
    inserted = 0
    total_sections = 0
    for h in hymns:
        sections = build_sections(h["stanzas"], h["refrain"])
        search_text = make_search_text(h["number"], h["title"], sections)
        
        cur.execute("""
            INSERT INTO hymns (number, title, search_text, category_id)
            VALUES (?, ?, ?, ?)
        """, (h["number"], h["title"], search_text, cat_id))
        hymn_id = cur.lastrowid
        
        for idx, sec in enumerate(sections):
            cur.execute("""
                INSERT INTO hymn_sections (hymn_id, order_index, type, text)
                VALUES (?, ?, ?, ?)
            """, (hymn_id, idx, sec["type"], sec["text"]))
            total_sections += 1
        
        inserted += 1
    
    conn.commit()
    conn.close()
    print(f"\n  ✅ Imported {inserted} Exploratori hymns with {total_sections} sections")


def main():
    do_import = "--import" in sys.argv
    
    print(f"Loading raw data from {RAW_JSON}...")
    with open(RAW_JSON) as f:
        data = json.load(f)
    
    print(f"Found {len(data)} files\n")
    
    hymns = []
    errors = []
    
    for fname in sorted(data.keys()):
        result = parse_hymn(fname, data[fname])
        if result:
            hymns.append(result)
    
    print(f"\nParsed {len(hymns)} hymns successfully")
    
    # Stats
    with_refrain = sum(1 for h in hymns if h["refrain"])
    total_stanzas = sum(len(h["stanzas"]) for h in hymns)
    avg_stanzas = total_stanzas / len(hymns) if hymns else 0
    print(f"  With refrain: {with_refrain}")
    print(f"  Total stanzas: {total_stanzas}, avg: {avg_stanzas:.1f}")
    
    # Show all titles
    print(f"\n{'Nr':>4s}  {'Title':<50s}  {'Stanzas':>7s}  {'Refrain':>7s}")
    print("-" * 80)
    for h in hymns:
        ref = "✓" if h["refrain"] else ""
        print(f"{h['number']:>4s}  {h['title']:<50s}  {len(h['stanzas']):>7d}  {ref:>7s}")
    
    if do_import:
        print(f"\nImporting into {DB_PATH}...")
        import_to_db(hymns, DB_PATH)
    else:
        print(f"\nDry run. Use --import to write to DB.")


if __name__ == "__main__":
    main()
