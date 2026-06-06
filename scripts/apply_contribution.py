#!/usr/bin/env python3
"""Aplică în seed (public/hymns.db) o contribuție primită prin formular.

RULAT MANUAL, doar de autori — DECIZIA de acceptare e exclusiv a ta; nimic nu se
aplică automat. Fluxul: copiezi conținutul celulei «Date (JSON)» din Sheet într-un
fișier, te uiți la diff cu --list, apoi accepți explicit ce vrei.

Usage:
  python3 scripts/apply_contribution.py contributie.json --list
  python3 scripts/apply_contribution.py contributie.json --accept 1,3
  python3 scripts/apply_contribution.py contributie.json --accept all

După acceptare:
  • imnul intră în seed cu updated_at proaspăt → pleacă la toți prin release-ul următor
  • pentru livrare imediată (OTA): scripts/publish_correction.py <Categorie> <numar>
"""

import json
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "public" / "hymns.db"

NFC = lambda s: unicodedata.normalize("NFC", s or "")


def search_text(number: str, title: str, sections) -> str:
    s = f"{number} {title} " + " ".join(x["text"] for x in sections)
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def quality_warnings(sections) -> list:
    warns = []
    for i, s in enumerate(sections):
        for line in s["text"].split("\n"):
            if len(line) >= 58:
                warns.append(f"  ⚠ secțiunea {i}: rând lung ({len(line)}): {line[:60]}…")
            if re.match(r"^\d{1,2}\.", line.strip()):
                warns.append(f"  ⚠ secțiunea {i}: număr de strofă rămas în text: {line[:40]}")
            if re.match(r"^\s*refren\b", line.strip(), re.I):
                warns.append(f"  ⚠ secțiunea {i}: marker «Refren» rămas în text")
            if "  " in line:
                warns.append(f"  ⚠ secțiunea {i}: spații duble: {line[:50]}")
    return warns


def show(idx, h):
    print(f"\n[{idx}] {h['action'].upper()} — {h.get('category') or '(fără categorie)'} "
          f"#{h['number']} «{h['title']}»  ({len(h['sections'])} secțiuni)")
    before = h.get("before")
    if before:
        if NFC(before["title"]) != NFC(h["title"]):
            print(f"  titlu înainte: {before['title']}\n  titlu după:    {h['title']}")
        m = max(len(h["sections"]), len(before["sections"]))
        for i in range(m):
            a = before["sections"][i] if i < len(before["sections"]) else None
            b = h["sections"][i] if i < len(h["sections"]) else None
            if a and b and a["type"] == b["type"] and NFC(a["text"]) == NFC(b["text"]):
                continue
            if a:
                print(f"  — înainte [{i}:{a['type']}]\n" + "\n".join("      " + l for l in a["text"].split("\n")))
            if b:
                print(f"  + după    [{i}:{b['type']}]\n" + "\n".join("      " + l for l in b["text"].split("\n")))
    else:
        for i, s in enumerate(h["sections"]):
            print(f"  [{i}:{s['type']}]\n" + "\n".join("      " + l for l in s["text"].split("\n")))
    for w in quality_warnings(h["sections"]):
        print(w)


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[2] not in ("--list",) and not sys.argv[2].startswith("--accept"):
        print(__doc__)
        sys.exit(1)

    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    hymns = payload.get("hymns", [])
    print(f"Contribuție de la instalarea {payload.get('installId', '?')[:8]}… "
          f"(app {payload.get('appVersion', '?')}), {len(hymns)} imnuri")

    if sys.argv[2] == "--list":
        for i, h in enumerate(hymns, 1):
            show(i, h)
        return

    sel = sys.argv[3] if len(sys.argv) > 3 else sys.argv[2].split("=", 1)[-1]
    indices = list(range(1, len(hymns) + 1)) if sel == "all" else [int(x) for x in sel.split(",")]

    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    applied = []

    for i in indices:
        h = hymns[i - 1]
        cat_name = h.get("category")
        if not cat_name:
            print(f"[{i}] sărit: fără categorie — adaugă-l manual dacă-l vrei")
            continue
        cat = con.execute("SELECT id FROM categories WHERE name = ?", (cat_name,)).fetchone()
        if not cat:
            print(f"[{i}] sărit: categoria «{cat_name}» nu există în seed")
            continue
        number = str(int(h["number"])).zfill(3) if str(h["number"]).isdigit() else str(h["number"])
        plain = str(int(h["number"])) if str(h["number"]).isdigit() else str(h["number"])
        stext = search_text(number, h["title"], h["sections"])
        row = con.execute("SELECT id FROM hymns WHERE category_id = ? AND number IN (?, ?)",
                          (cat[0], number, plain)).fetchone()
        if row:
            hid = row[0]
            con.execute("UPDATE hymns SET title = ?, search_text = ?, updated_at = ? WHERE id = ?",
                        (h["title"], stext, now, hid))
            con.execute("DELETE FROM hymn_sections WHERE hymn_id = ?", (hid,))
        else:
            cur = con.execute(
                "INSERT INTO hymns (number, title, search_text, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (number, h["title"], stext, cat[0], now, now))
            hid = cur.lastrowid
        for j, s in enumerate(h["sections"]):
            con.execute(
                "INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at) VALUES (?, ?, ?, ?, ?)",
                (hid, j, s["type"], s["text"], now))
        applied.append((cat_name, number, h["title"]))
        print(f"[{i}] ✓ aplicat: {cat_name} #{number} «{h['title']}»")

    con.commit()
    ok = con.execute("PRAGMA integrity_check").fetchone()[0]
    con.close()
    print(f"\nintegrity_check: {ok}")
    if applied:
        print("Pentru livrare imediată (OTA), rulează apoi:")
        for cat_name, number, _ in applied:
            print(f'  python3 scripts/publish_correction.py "{cat_name}" {int(number)}')


if __name__ == "__main__":
    main()
