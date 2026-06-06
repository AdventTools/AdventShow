#!/usr/bin/env python3
"""Publică o corectură în feed-ul OTA (content/corrections.json).

RULAT MANUAL, doar de autori. Ia conținutul CANONIC al imnului din seed
(public/hymns.db) — deci întâi aplici corectura în seed (manual sau cu
apply_contribution.py), apoi o publici aici.

Usage:
  python3 scripts/publish_correction.py <Categorie> <numar> [<numar>...] [--force]

  --force   suprascrie la utilizatori inclusiv modificările lor proprii
            (implicit, modificările proprii ale utilizatorului au prioritate)

Exemple:
  python3 scripts/publish_correction.py Exploratori 7
  python3 scripts/publish_correction.py "Imnuri Creștine" 1 562 --force

După rulare: verifică diff-ul, apoi commit + push — abia push-ul publică efectiv.
"""

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "public" / "hymns.db"
FEED = ROOT / "content" / "corrections.json"


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    category, numbers = args[0], args[1:]

    con = sqlite3.connect(DB)
    cat = con.execute("SELECT id FROM categories WHERE name = ?", (category,)).fetchone()
    if not cat:
        names = [r[0] for r in con.execute("SELECT name FROM categories ORDER BY id")]
        sys.exit(f"Categoria «{category}» nu există. Disponibile: {', '.join(names)}")

    feed = json.loads(FEED.read_text(encoding="utf-8"))
    entries = feed.setdefault("entries", [])
    next_seq = max((e.get("seq", 0) for e in entries), default=0) + 1
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    for raw in numbers:
        # seed-ul poate stoca numărul normalizat ('007') sau brut ('7')
        number = str(int(raw)).zfill(3) if raw.isdigit() else raw
        plain = str(int(raw)) if raw.isdigit() else raw
        row = con.execute(
            "SELECT id, title FROM hymns WHERE category_id = ? AND number IN (?, ?)",
            (cat[0], number, plain),
        ).fetchone()
        if not row:
            sys.exit(f"Imnul {category} #{number} nu există în seed ({DB}).")
        hid, title = row
        sections = [
            {"type": t, "text": x}
            for t, x in con.execute(
                "SELECT type, text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index",
                (hid,),
            )
        ]
        entries.append({
            "seq": next_seq,
            "category": category,
            "number": number,
            "title": title,
            "sections": sections,
            "force": force,
            "ts": now,
        })
        print(f"  + seq {next_seq}: {category} #{number} «{title}» "
              f"({len(sections)} secțiuni){' [FORȚAT]' if force else ''}")
        next_seq += 1

    FEED.write_text(json.dumps(feed, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nScris: {FEED}")
    print("Publicarea devine efectivă DOAR după:")
    print('  git add content/corrections.json && git commit -m "content: corecturi OTA" && git push')


if __name__ == "__main__":
    main()
