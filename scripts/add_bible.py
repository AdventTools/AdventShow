#!/usr/bin/env python3
"""
Add Cornilescu Bible data to the hymns.db database.
Creates bible_books and bible_verses tables.
"""

import json
import sqlite3
import sys
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "app-unpacked", "dist", "hymns.db")
JSON_PATH = os.path.join(os.path.dirname(__file__), "cornilescu.json")

# Also update the win-unpacked copy
DB_PATH_WIN = os.path.join(os.path.dirname(__file__), "win-unpacked", "resources", "hymns.db")

ABBREVIATIONS = {
    "Geneza": "Gen", "Exodul": "Exod", "Leviticul": "Lev",
    "Numeri": "Num", "Deuteronomul": "Deut", "Iosua": "Ios",
    "Judecători": "Jud", "Rut": "Rut", "1 Samuel": "1Sam",
    "2 Samuel": "2Sam", "1 Împărați": "1Imp", "2 Împărați": "2Imp",
    "1 Cronici": "1Cron", "2 Cronici": "2Cron", "Ezra": "Ezra",
    "Neemia": "Neem", "Estera": "Est", "Iov": "Iov",
    "Psalmii": "Ps", "Proverbe": "Prov", "Eclesiastul": "Ecl",
    "Cântarea Cântărilor": "Cânt", "Isaia": "Is", "Ieremia": "Ier",
    "Plângerile lui Ieremia": "Plâng", "Ezechiel": "Ez",
    "Daniel": "Dan", "Osea": "Os", "Ioel": "Ioel",
    "Amos": "Amos", "Obadia": "Ob", "Iona": "Iona",
    "Mica": "Mica", "Naum": "Naum", "Habacuc": "Hab",
    "Țefania": "Tef", "Hagai": "Hag", "Zaharia": "Zah",
    "Maleahi": "Mal", "Matei": "Mat", "Marcu": "Marc",
    "Luca": "Luca", "Ioan": "Ioan", "Faptele Apostolilor": "Fapte",
    "Romani": "Rom", "1 Corinteni": "1Cor", "2 Corinteni": "2Cor",
    "Galateni": "Gal", "Efeseni": "Ef", "Filipeni": "Fil",
    "Coloseni": "Col", "1 Tesaloniceni": "1Tes", "2 Tesaloniceni": "2Tes",
    "1 Timotei": "1Tim", "2 Timotei": "2Tim", "Titus": "Tit",
    "Filimon": "Flm", "Evrei": "Evr", "Iacov": "Iac",
    "1 Petru": "1Pet", "2 Petru": "2Pet", "1 Ioan": "1Ioan",
    "2 Ioan": "2Ioan", "3 Ioan": "3Ioan", "Iuda": "Iuda",
    "Apocalipsa": "Apoc"
}

def add_bible_to_db(db_path):
    print(f"Loading Bible JSON from {JSON_PATH}...")
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    books = data['books']
    print(f"Found {len(books)} books")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Create tables
    cur.execute("""
        CREATE TABLE IF NOT EXISTS bible_books (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            abbreviation TEXT NOT NULL,
            testament TEXT NOT NULL CHECK(testament IN ('VT', 'NT')),
            book_order INTEGER NOT NULL,
            chapter_count INTEGER NOT NULL DEFAULT 0
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bible_verses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL REFERENCES bible_books(id),
            chapter INTEGER NOT NULL,
            verse INTEGER NOT NULL,
            text TEXT NOT NULL
        )
    """)

    # Create indexes for fast lookup
    cur.execute("CREATE INDEX IF NOT EXISTS idx_bible_verses_book_chapter ON bible_verses(book_id, chapter)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_bible_verses_text ON bible_verses(text)")

    # Clear existing data
    cur.execute("DELETE FROM bible_verses")
    cur.execute("DELETE FROM bible_books")

    total_verses = 0
    for book in books:
        book_nr = book['nr']
        book_name = book['name']
        abbr = ABBREVIATIONS.get(book_name, book_name[:4])
        testament = 'VT' if book_nr <= 39 else 'NT'
        chapters = book['chapters']
        chapter_count = len(chapters)

        cur.execute(
            "INSERT INTO bible_books (id, name, abbreviation, testament, book_order, chapter_count) VALUES (?, ?, ?, ?, ?, ?)",
            (book_nr, book_name, abbr, testament, book_nr, chapter_count)
        )

        for chapter in chapters:
            ch_num = chapter['chapter']
            for verse in chapter['verses']:
                v_num = verse['verse']
                v_text = verse['text'].strip()
                cur.execute(
                    "INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)",
                    (book_nr, ch_num, v_num, v_text)
                )
                total_verses += 1

    conn.commit()
    conn.close()
    print(f"Inserted {len(books)} books and {total_verses} verses into {db_path}")

if __name__ == '__main__':
    for path in [DB_PATH, DB_PATH_WIN]:
        if os.path.exists(path):
            print(f"\n--- Processing {path} ---")
            add_bible_to_db(path)
        else:
            print(f"Skipping {path} (not found)")
    print("\nDone!")
