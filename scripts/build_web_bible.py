#!/usr/bin/env python3
"""
Construiește scripts/web.json (Biblia WEB, engleză, domeniu public) din
textul verset-per-linie descărcat de la eBible.org (engwebp_vpl.txt),
în EXACT aceeași formă ca scripts/cornilescu.json — ca seedBibleFromJson()
din electron/db.ts să poată citi oricare din cele două fără cod separat.

Sursă: https://ebible.org/Scriptures/engwebp_vpl.zip (World English Bible,
ediția protestantă cu 66 de cărți, domeniu public, fără restricții).

Rulare: python3 scripts/build_web_bible.py /cale/catre/engwebp_vpl.txt
"""

import json
import re
import sys
import os

# Ordinea canonică a celor 66 de cărți. Codul de 3 litere e cel folosit chiar
# de fișierul eBible.org (nu USFM standard — diferă la Ioel/Cântarea/Ezechiel/
# Ioan/Marcu/Filipeni/Iacov/1-2-3 Ioan; verificat prin numărarea versetelor pe
# cod din engwebp_vpl.txt, care dă exact 66 de coduri distincte).
BOOKS = [
    ("GEN", "Genesis", "Gen", "VT"), ("EXO", "Exodus", "Exod", "VT"),
    ("LEV", "Leviticus", "Lev", "VT"), ("NUM", "Numbers", "Num", "VT"),
    ("DEU", "Deuteronomy", "Deut", "VT"), ("JOS", "Joshua", "Josh", "VT"),
    ("JDG", "Judges", "Judg", "VT"), ("RUT", "Ruth", "Ruth", "VT"),
    ("1SA", "1 Samuel", "1Sam", "VT"), ("2SA", "2 Samuel", "2Sam", "VT"),
    ("1KI", "1 Kings", "1Kgs", "VT"), ("2KI", "2 Kings", "2Kgs", "VT"),
    ("1CH", "1 Chronicles", "1Chr", "VT"), ("2CH", "2 Chronicles", "2Chr", "VT"),
    ("EZR", "Ezra", "Ezra", "VT"), ("NEH", "Nehemiah", "Neh", "VT"),
    ("EST", "Esther", "Esth", "VT"), ("JOB", "Job", "Job", "VT"),
    ("PSA", "Psalms", "Ps", "VT"), ("PRO", "Proverbs", "Prov", "VT"),
    ("ECC", "Ecclesiastes", "Eccl", "VT"), ("SOL", "Song of Solomon", "Song", "VT"),
    ("ISA", "Isaiah", "Isa", "VT"), ("JER", "Jeremiah", "Jer", "VT"),
    ("LAM", "Lamentations", "Lam", "VT"), ("EZE", "Ezekiel", "Ezek", "VT"),
    ("DAN", "Daniel", "Dan", "VT"), ("HOS", "Hosea", "Hos", "VT"),
    ("JOE", "Joel", "Joel", "VT"), ("AMO", "Amos", "Amos", "VT"),
    ("OBA", "Obadiah", "Obad", "VT"), ("JON", "Jonah", "Jonah", "VT"),
    ("MIC", "Micah", "Mic", "VT"), ("NAH", "Nahum", "Nah", "VT"),
    ("HAB", "Habakkuk", "Hab", "VT"), ("ZEP", "Zephaniah", "Zeph", "VT"),
    ("HAG", "Haggai", "Hag", "VT"), ("ZEC", "Zechariah", "Zech", "VT"),
    ("MAL", "Malachi", "Mal", "VT"),
    ("MAT", "Matthew", "Matt", "NT"), ("MAR", "Mark", "Mark", "NT"),
    ("LUK", "Luke", "Luke", "NT"), ("JOH", "John", "John", "NT"),
    ("ACT", "Acts", "Acts", "NT"), ("ROM", "Romans", "Rom", "NT"),
    ("1CO", "1 Corinthians", "1Cor", "NT"), ("2CO", "2 Corinthians", "2Cor", "NT"),
    ("GAL", "Galatians", "Gal", "NT"), ("EPH", "Ephesians", "Eph", "NT"),
    ("PHI", "Philippians", "Phil", "NT"), ("COL", "Colossians", "Col", "NT"),
    ("1TH", "1 Thessalonians", "1Thess", "NT"), ("2TH", "2 Thessalonians", "2Thess", "NT"),
    ("1TI", "1 Timothy", "1Tim", "NT"), ("2TI", "2 Timothy", "2Tim", "NT"),
    ("TIT", "Titus", "Titus", "NT"), ("PHM", "Philemon", "Phlm", "NT"),
    ("HEB", "Hebrews", "Heb", "NT"), ("JAM", "James", "Jas", "NT"),
    ("1PE", "1 Peter", "1Pet", "NT"), ("2PE", "2 Peter", "2Pet", "NT"),
    ("1JO", "1 John", "1John", "NT"), ("2JO", "2 John", "2John", "NT"),
    ("3JO", "3 John", "3John", "NT"), ("JUD", "Jude", "Jude", "NT"),
    ("REV", "Revelation", "Rev", "NT"),
]
CODE_TO_INFO = {code: (i + 1, name, abbr, test) for i, (code, name, abbr, test) in enumerate(BOOKS)}

LINE_RE = re.compile(r'^([A-Z1-3]{3})\s+(\d+):(\d+)\s+(.*)$')


def main():
    if len(sys.argv) < 2:
        print("Utilizare: python3 build_web_bible.py <engwebp_vpl.txt>", file=sys.stderr)
        sys.exit(1)

    src_path = sys.argv[1]
    out_path = os.path.join(os.path.dirname(__file__), "web.json")

    # book_nr -> chapter -> verse -> text
    books_data: dict[int, dict[int, dict[int, str]]] = {}
    unmatched = 0
    total = 0

    with open(src_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line.strip():
                continue
            m = LINE_RE.match(line)
            if not m:
                unmatched += 1
                continue
            code, ch, vs, text = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).strip()
            info = CODE_TO_INFO.get(code)
            if not info:
                unmatched += 1
                continue
            nr = info[0]
            books_data.setdefault(nr, {}).setdefault(ch, {})[vs] = text
            total += 1

    if unmatched:
        print(f"EROARE: {unmatched} linii nepotrivite — opresc, ca să nu public o Biblie ciuntită", file=sys.stderr)
        sys.exit(1)
    if len(books_data) != 66:
        print(f"EROARE: {len(books_data)} cărți găsite, nu 66 — opresc", file=sys.stderr)
        sys.exit(1)

    out_books = []
    for code, name, abbr, testament in BOOKS:
        nr, _, _, _ = CODE_TO_INFO[code]
        chapters_dict = books_data.get(nr, {})
        chapters_out = []
        for ch_num in sorted(chapters_dict.keys()):
            verses_dict = chapters_dict[ch_num]
            verses_out = []
            for v_num in sorted(verses_dict.keys()):
                verses_out.append({
                    "chapter": ch_num,
                    "verse": v_num,
                    "name": f"{name} {ch_num}:{v_num}",
                    "text": verses_dict[v_num],
                })
            chapters_out.append({
                "chapter": ch_num,
                "name": f"{name} {ch_num}",
                "verses": verses_out,
            })
        out_books.append({
            "nr": nr,
            "name": name,
            "abbreviation": abbr,
            "testament": testament,
            "chapters": chapters_out,
        })

    out = {
        "translation": "World English Bible",
        "abbreviation": "web",
        "description": "World English Bible (public domain)",
        "lang": "en",
        "language": "English",
        "direction": "LTR",
        "encoding": "UTF-8",
        "books": out_books,
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Scris {out_path}: {len(out_books)} cărți, {total} versete")


if __name__ == '__main__':
    main()
