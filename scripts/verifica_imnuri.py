#!/usr/bin/env python3
"""Controlul de forma al textelor de imnuri din baza livrată (public/hymns.db).

Orice imn atins de o corectură trebuie să treacă înainte de commit. Regulile vin din
docs/ops/continut-imnuri.md:
  - cel mult 10 rânduri pe un ecran; o strofă mai lungă se taie cu un rând `---`;
  - cel mult 55 de caractere pe rând (cel mai lung rând din colecții are 53);
  - repetarea se scrie `[: … :]` sau `[: … :] ×N`, nu `(: … :)`;
  - diacriticele cu virgulă (ș, ț), nu cu sedilă (ş, ţ) și nu „ã”;
  - fără spații duble, spații la capăt de rând sau rânduri goale în interior;
  - tipul secțiunii e `strofa` sau `refren`;
  - `search_text` e cel calculat din număr, titlu și secțiuni.

Utilizare:
  python3 scripts/verifica_imnuri.py                      # colecțiile copiilor și tinerilor
  python3 scripts/verifica_imnuri.py "Imnuri Creștine"    # alte colecții, după nume
  python3 scripts/verifica_imnuri.py --db alta.db Amicus

Iese cu cod 1 dacă găsește cel puțin o problemă.
"""

import re
import sqlite3
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPLICIT = ["Amicus", "Companioni", "Exploratori", "Licurici", "Tineret"]
MAX_RANDURI = 10
MAX_CARACTERE = 55


def search_text(number: str, title: str, texts) -> str:
    s = f"{number} {title} " + " ".join(texts)
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def probleme_sectiune(tip: str, text: str) -> list:
    out = []
    if tip not in ("strofa", "refren"):
        out.append(f"tip necunoscut «{tip}»")
    if re.search(r"[şţŞŢãÃ]", text):
        out.append("diacritice cu sedilă (ş, ţ) sau „ã”")
    if "(:" in text or ":)" in text:
        out.append("repetare scrisă (: :) în loc de [: :]")
    if text.count("[:") != text.count(":]"):
        out.append("[: și :] nepereche")
    for m in re.finditer(r":\]\s*[x×]\s*(\S*)", text):
        if not re.fullmatch(r"\d+", m.group(1)) or ":] ×" not in text:
            out.append("număr de repetări scris altfel decât «:] ×N»")
    for ecran in text.split("\n---\n"):
        randuri = ecran.split("\n")
        if len(randuri) > MAX_RANDURI:
            out.append(f"{len(randuri)} rânduri pe un ecran (maximum {MAX_RANDURI}, taie cu ---)")
        for r in randuri:
            if not r.strip():
                out.append("rând gol în interior")
            elif r != r.strip():
                out.append(f"spații la capăt de rând: «{r}»")
            elif "  " in r:
                out.append(f"spațiu dublu: «{r}»")
            elif len(r) > MAX_CARACTERE:
                out.append(f"rând de {len(r)} caractere: «{r}»")
    return out


def main() -> None:
    args = sys.argv[1:]
    db = ROOT / "public" / "hymns.db"
    if "--db" in args:
        i = args.index("--db")
        db = Path(args[i + 1])
        del args[i:i + 2]
    colectii = args or IMPLICIT
    con = sqlite3.connect(db)
    total = imnuri = 0
    for col in colectii:
        rows = con.execute(
            "SELECT h.id, h.number, h.title, h.search_text FROM hymns h "
            "JOIN categories c ON c.id = h.category_id WHERE c.name = ? ORDER BY h.number",
            (col,),
        ).fetchall()
        if not rows:
            sys.exit(f"colecția «{col}» nu există sau e goală")
        for hid, number, title, stext in rows:
            imnuri += 1
            secs = con.execute(
                "SELECT type, text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index", (hid,)
            ).fetchall()
            gasite = []
            if not secs:
                gasite.append("imn fără secțiuni")
            if title != title.strip() or "  " in title or re.search(r"[şţŞŢãÃ]", title):
                gasite.append(f"titlu cu probleme de scriere: «{title}»")
            for i, (tip, text) in enumerate(secs, 1):
                gasite += [f"secțiunea {i}: {p}" for p in probleme_sectiune(tip, text)]
            if stext != search_text(number, title, [t for _, t in secs]):
                gasite.append("search_text nu corespunde textului")
            for p in gasite:
                print(f"{col} {number} «{title}»: {p}")
            total += len(gasite)
    print(f"\n{imnuri} imnuri verificate, {total} probleme")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
