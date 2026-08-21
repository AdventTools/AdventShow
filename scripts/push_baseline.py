#!/usr/bin/env python3
"""Trimite baza livrata (`public/hymns.db`) in hangar, ca snapshot oficial.

Hangar compara propunerile bisericilor cu textul pe care il publicam noi. Daca snapshotul
lui ramane in urma dupa un release care a schimbat imnuri, doua lucruri se strica in tacere:
filtrul care marcheaza automat ecourile („deja livrat") compara cu textul vechi, iar coloana
„oficial" din API si din interfata arata altceva decat livram.

De rulat dupa ORICE release care atinge `public/hymns.db`.

    scripts/push_baseline.py            # trimite
    scripts/push_baseline.py --dry-run  # doar arata cate intrari si cat ocupa

Corpul unei cereri e limitat la 1 MB de nginx, iar snapshotul are ~1,13 MB, deci se trimite
in transe: begin → chunk × n → commit. Comitul inlocuieste tot, intr-o singura tranzactie.
`changed: false` in raspuns inseamna ca release-ul n-a atins textele — informatie, nu esec.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SEED = REPO / 'public' / 'hymns.db'
API = 'https://hangar.it4all.ro/hub/api.php'
TOKENS_ENV = Path.home() / '.hangar' / 'tokens.env'
CHUNK_BYTES = 700_000          # sub limita de 1 MB, cu loc de antet si de escapari


def token() -> str:
    if TOKENS_ENV.exists():
        for line in TOKENS_ENV.read_text().splitlines():
            if line.startswith('ADVENTSHOW_HUB_TOKEN='):
                return line.split('=', 1)[1].strip().strip('"')
    sys.exit(f'lipseste ADVENTSHOW_HUB_TOKEN din {TOKENS_ENV}')


def post(body: dict, tok: str) -> dict:
    req = urllib.request.Request(
        API, data=json.dumps(body, ensure_ascii=False).encode(),
        headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        sys.exit(f'hangar a refuzat ({e.code}): {e.read().decode(errors="replace")[:400]}')


def snapshot() -> list[dict]:
    """Aceeasi forma pe care o asteapta hangar: colectie, numar, titlu, sectiuni."""
    con = sqlite3.connect(f'file:{SEED}?mode=ro', uri=True)
    try:
        rows = con.execute(
            'SELECT c.name, h.id, h.number, h.title FROM hymns h '
            'JOIN categories c ON c.id = h.category_id ORDER BY c.name, h.number').fetchall()
        out = []
        for cat, hid, number, title in rows:
            sections = [{'type': t, 'text': unicodedata.normalize('NFC', tx)}
                        for t, tx in con.execute(
                            'SELECT type, text FROM hymn_sections WHERE hymn_id = ? '
                            'ORDER BY order_index', (hid,))]
            if not sections:
                continue
            num = str(number or '').strip()
            out.append({'category': cat, 'number': num.zfill(3) if num.isdigit() else num,
                        'title': unicodedata.normalize('NFC', title or ''), 'sections': sections})
        return out
    finally:
        con.close()


def chunks(items: list[dict]) -> list[list[dict]]:
    batches, cur = [], []
    for it in items:
        cur.append(it)
        if len(json.dumps(cur, ensure_ascii=False).encode()) > CHUNK_BYTES:
            cur.pop()
            batches.append(cur)
            cur = [it]
    if cur:
        batches.append(cur)
    return batches


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='nu trimite nimic')
    args = ap.parse_args()

    version = json.loads((REPO / 'package.json').read_text())['version']
    items = snapshot()
    batches = chunks(items)
    total = len(json.dumps(items, ensure_ascii=False).encode())
    print(f'{len(items)} imnuri, {total / 1024:.0f} KB, {len(batches)} transe — sursa hymns.db@{version}')
    if args.dry_run:
        return

    tok = token()
    imp = post({'do': 'baseline.begin', 'project': 'adventshow', 'kind': 'hymn',
                'source': f'hymns.db@{version}'}, tok)['import']
    try:
        for i, batch in enumerate(batches, 1):
            r = post({'do': 'baseline.chunk', 'import': imp, 'items': batch}, tok)
            print(f'  transa {i}/{len(batches)}: {len(batch)} intrari, pregatite {r.get("staged")}')
        r = post({'do': 'baseline.commit', 'import': imp}, tok)
    except SystemExit:
        post({'do': 'baseline.abort', 'import': imp}, tok)
        raise
    print(f'gata: {r["stored"]} intrari, {r["count_before"]} → {r["count_after"]}, '
          f'{"textele s-au schimbat" if r.get("changed") else "textele sunt aceleasi"} '
          f'({r["revision_before"][:8]} → {r["revision_after"][:8]})')


if __name__ == '__main__':
    main()
