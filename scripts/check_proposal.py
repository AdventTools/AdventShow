#!/usr/bin/env python3
"""Judeca o propunere de imn INAINTE de a o accepta.

O propunere care aduce un text mai vechi decat ce avem in baza livrata nu e o
corectura — e un ecou. Trei feluri de ecou s-au vazut deja in practica:

  • aplicatia a primit corectura noastra prin OTA si ne-o retrimite ca „modificare
    a utilizatorului" (instalarile sub 1.4.2 nu tin minte ce au primit);
  • acelasi imn re-propus de biserica lui de pe o instalare noua;
  • o varianta pe care noi am schimbat-o deliberat mai tarziu, care se intoarce
    aratand ca o corectura la decizia noastra.

Ultimul caz e cel periculos: fara verificarea de mai jos arata identic cu o
corectura reala, iar acceptarea lui anuleaza in tacere o decizie a autorului.
De aceea scriptul se uita in ISTORICUL git al bazei livrate, nu doar in ea.

Utilizare:
    scripts/check_proposal.py --json fisier.json      # payload de la formularul vechi
    scripts/check_proposal.py --hangar-id 107          # propunere din hangar (API)
    cat payload.json | scripts/check_proposal.py -
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SEED = REPO / 'public' / 'hymns.db'
CORRECTIONS = REPO / 'content' / 'corrections.json'
HANGAR_API = 'https://hangar.it4all.ro/hub/api.php'
TOKENS_ENV = Path.home() / '.hangar' / 'tokens.env'


# ── normalizare ───────────────────────────────────────────────────────────────

def nfc(text: str) -> str:
    return unicodedata.normalize('NFC', (text or '').replace('\r\n', '\n').replace('\r', '\n')).strip()


def strip_leading_number(text: str) -> str:
    """«1. O cantare…» si «O cantare…» sunt acelasi text; unele trimiteri numeroteaza strofele."""
    return re.sub(r'^\s*\d+\.\s*', '', text)


def key_of(sections: list[dict]) -> tuple:
    return tuple((s.get('type'), nfc(strip_leading_number(s.get('text', '')))) for s in sections)


# ── baza livrata, la orice moment din istoric ─────────────────────────────────

def read_hymn(db_path: Path, category: str, number: str) -> dict | None:
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        try:
            num = int(str(number).strip())
        except ValueError:
            return None
        row = con.execute(
            'SELECT h.id, h.title, h.updated_at FROM hymns h JOIN categories c ON c.id = h.category_id '
            'WHERE c.name = ? AND CAST(h.number AS INTEGER) = ? LIMIT 1', (category, num)).fetchone()
        if not row:
            return None
        hid, title, updated = row
        sections = [{'type': t, 'text': tx, 'updated_at': u} for t, tx, u in con.execute(
            'SELECT type, text, updated_at FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index', (hid,))]
        newest = max([updated or ''] + [s['updated_at'] or '' for s in sections])
        return {'id': hid, 'title': title, 'sections': sections, 'updated_at': newest}
    finally:
        con.close()


def find_anywhere(db_path: Path, number: str, title: str) -> list[tuple[str, dict]]:
    """Acelasi imn traieste uneori sub alta colectie — «Imnurile mele» in loc de «Imnuri Speciale»."""
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        cats = [r[0] for r in con.execute('SELECT name FROM categories')]
    finally:
        con.close()
    found = []
    for cat in cats:
        h = read_hymn(db_path, cat, number)
        if h and (nfc(h['title']).lower() == nfc(title).lower() or True):
            found.append((cat, h))
    return found


def seed_history() -> list[tuple[str, str]]:
    """(commit, data) pentru fiecare stare a bazei livrate, de la cea mai noua."""
    out = subprocess.run(['git', 'log', '--format=%H\t%cI', '--', 'public/hymns.db'],
                         cwd=REPO, capture_output=True, text=True, check=True).stdout
    return [tuple(line.split('\t')) for line in out.splitlines() if line.strip()]


def seed_at(commit: str) -> Path:
    fd, path = tempfile.mkstemp(suffix='.db')
    with os.fdopen(fd, 'wb') as fh:
        fh.write(subprocess.run(['git', 'show', f'{commit}:public/hymns.db'],
                                cwd=REPO, capture_output=True, check=True).stdout)
    return Path(path)


# ── corecturile deja publicate ────────────────────────────────────────────────

def published_corrections() -> list[dict]:
    if not CORRECTIONS.exists():
        return []
    return json.loads(CORRECTIONS.read_text()).get('entries', [])


# ── propunerea ────────────────────────────────────────────────────────────────

def from_hangar(pid: int) -> list[dict]:
    token = ''
    if TOKENS_ENV.exists():
        for line in TOKENS_ENV.read_text().splitlines():
            if line.startswith('ADVENTSHOW_HUB_TOKEN='):
                token = line.split('=', 1)[1].strip().strip('"')
    if not token:
        sys.exit(f'lipseste ADVENTSHOW_HUB_TOKEN din {TOKENS_ENV}')
    req = urllib.request.Request(f'{HANGAR_API}?do=proposal&id={pid}',
                                 headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req, timeout=30) as res:
        p = json.load(res)['proposal']
    return [{'action': p['action'], 'category': p['category'], 'number': p['number'],
             'title': p['title'], 'sections': p['sections'],
             '_meta': f"hangar #{p['id']} · {p['status']} · {p['votes']} voturi · "
                      f"{p['installs']} instalari · app {p['version']} · {p['created_at'][:10]}"}]


def from_payload(raw: str) -> list[dict]:
    data = json.loads(raw)
    meta = f"{data.get('appVersion', '?')} ({data.get('platform', '?')}) · " \
           f"instalare {str(data.get('installId', ''))[:8]} · {str(data.get('generatedAt', ''))[:10]}"
    hymns = data.get('hymns', data if isinstance(data, list) else [])
    for h in hymns:
        h['_meta'] = meta
    return hymns


# ── verdictul ─────────────────────────────────────────────────────────────────

def diff(a: list[dict], b: list[dict], label_a: str, label_b: str) -> list[str]:
    lines = []
    for i, (x, y) in enumerate(zip(a, b)):
        tx, ty = nfc(strip_leading_number(x.get('text', ''))), nfc(strip_leading_number(y.get('text', '')))
        if x.get('type') != y.get('type') or tx != ty:
            lines.append(f'  secțiunea {i} ({x.get("type")} → {y.get("type")})')
            lines += ['    ' + ln for ln in difflib.unified_diff(
                tx.split('\n'), ty.split('\n'), lineterm='', n=1, fromfile=label_a, tofile=label_b)]
    if len(a) != len(b):
        lines.append(f'  număr de secțiuni: {label_a}={len(a)} {label_b}={len(b)}')
    return lines


def judge(h: dict, history: list[tuple[str, str]], corrections: list[dict]) -> None:
    cat, num, title = h.get('category') or '', str(h.get('number') or ''), h.get('title') or ''
    proposed = h['sections']
    print('=' * 78)
    print(f'{cat} {num} — {title!r}   [{h.get("action", "?")}]')
    if h.get('_meta'):
        print(f'  sursă: {h["_meta"]}')

    current = read_hymn(SEED, cat, num)
    slot = f'{cat} {num}'
    if not current:
        elsewhere = [(c, x) for c, x in find_anywhere(SEED, num, title)
                     if nfc(x['title']).lower() == nfc(title).lower()]
        if elsewhere:
            cat_alt, current = elsewhere[0]
            slot = f'{cat_alt} {num}'
            print(f'  ATENȚIE: în baza livrată nu există la «{cat}», dar același titlu stă la «{cat_alt}».')
            print('           Acceptarea pe numărul cerut ar face un duplicat.')
        else:
            print('  VERDICT: imn NOU — nu există nicăieri în baza livrată. Se judecă pe conținut.')
            return

    print(f'  în baza livrată: «{slot}», ultima atingere {current["updated_at"] or "necunoscută"}')

    if key_of(current['sections']) == key_of(proposed) and nfc(current['title']) == nfc(title):
        print('  VERDICT: ECOU — identic cu ce livrăm. Nimic de aplicat.')
        return

    # Ecoul unei corecturi publicate: textul propus e chiar corectura noastra, iar baza
    # livrata a fost schimbata DUPA ea. Cazul care pacaleste: arata ca o corectura noua.
    for entry in corrections:
        if key_of(entry.get('sections', [])) != key_of(proposed):
            continue
        ts = str(entry.get('ts') or '')
        newer = (current['updated_at'] or '') > ts
        print(f'  identic cu corectura publicată seq {entry["seq"]} ({entry.get("category")} '
              f'{entry.get("number")}, ts {ts[:19]})')
        if newer:
            print('  VERDICT: ÎNVECHIT — corectura asta a fost deja înlocuită în baza livrată,')
            print(f'           care a fost atinsă mai târziu ({current["updated_at"][:19]}).')
            print('           NU o aplica: ai anula o decizie luată după publicarea corecturii.')
            print('           Reparația e o corectură NOUĂ cu textul actual, nu revenirea la ăsta.')
        else:
            print('  VERDICT: ECOU al unei corecturi publicate, dar baza livrată nu a fost atinsă')
            print('           de atunci — verifică dacă seed-ul a rămas în urmă față de feed.')
        print('\n'.join(diff(current['sections'], proposed, 'livrat', 'propus')))
        return

    # Revenire la o stare veche a bazei livrate: textul propus a FOST al nostru cândva.
    for commit, when in history:
        old_path = seed_at(commit)
        try:
            old = read_hymn(old_path, slot.rsplit(' ', 1)[0], num)
        finally:
            old_path.unlink(missing_ok=True)
        if not old:
            continue
        if key_of(old['sections']) == key_of(proposed):
            if key_of(old['sections']) == key_of(current['sections']):
                break  # e chiar starea curenta, tratata mai sus
            print(f'  VERDICT: REVENIRE — exact textul pe care îl livram până la commit-ul')
            print(f'           {commit[:9]} ({when[:10]}), unde l-ai schimbat deliberat.')
            print('           Acceptarea ar anula acea schimbare. Confirmă înainte de orice.')
            print('\n'.join(diff(current['sections'], proposed, 'livrat acum', 'propus (vechi)')))
            return

    print('  VERDICT: SCHIMBARE REALĂ — nu se regăsește nici în baza livrată, nici în istoricul ei.')
    if nfc(current['title']) != nfc(title):
        print(f'  titlu: livrat {current["title"]!r} → propus {title!r}')
    print('\n'.join(diff(current['sections'], proposed, 'livrat', 'propus')))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--hangar-id', type=int, help='id-ul propunerii din hangar')
    g.add_argument('--json', help='fișier cu payload-ul trimis de aplicație')
    g.add_argument('-', dest='stdin', action='store_true', help='payload-ul pe intrarea standard')
    args = ap.parse_args()

    if args.hangar_id:
        hymns = from_hangar(args.hangar_id)
    elif args.json:
        hymns = from_payload(Path(args.json).read_text())
    else:
        hymns = from_payload(sys.stdin.read())

    history, corrections = seed_history(), published_corrections()
    for h in hymns:
        judge(h, history, corrections)
    print('=' * 78)


if __name__ == '__main__':
    main()
