#!/usr/bin/env python3
"""
Import missing hymns from PPT/PPTX files into hymns.db.

Usage:
    python scripts/import_missing_hymns.py          # dry run
    python scripts/import_missing_hymns.py --apply  # actually insert
"""
import os
import re
import json
import sqlite3
import struct
import zipfile
import sys

try:
    import olefile
except ImportError:
    print("ERROR: olefile is required. Run: pip install olefile")
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "hymns.db")
PPT_DIR = "/Users/samy/Downloads/imnuri/Imnuri"
CATEGORY_NAME = "Imnuri Creștine"
APPLY = "--apply" in sys.argv

# Missing hymns to import (from comm comparison)
MISSING_NUMBERS = [
    "122", "250", "251", "252", "253", "254", "255", "256", "257", "258", "259",
    "311", "314", "379", "404", "664 A", "664 B", "869"
]

# Manual title overrides for hymns where auto-parsing gets it wrong
TITLE_OVERRIDES = {
    "869": "Într-o simțire",
}

# Manual section data for hymns that fail to auto-parse
MANUAL_SECTIONS = {
    "256": {
        "title": "Domnu-i Păstorul meu",
        "sections": [
            {"type": "strofa", "text": "Domnu-i Păstorul meu,\nNimic nu-mi va lipsi;\nPe verzi câmpii mă hrănește,\nCu ape limpezi mă-mpărtășește,\nSufletul mi-l înnoiește,\nNimic nu-mi va lipsi."},
            {"type": "strofa", "text": "Chiar de voi umbla prin\nÎntuneric de moarte,\nDe nici un rău nu mă tem;\nCu Tine nu voi fi-nfrânt.\nToiagul Tău şi drugul Tău\nMă mângâie, mă mângâie."},
            {"type": "strofa", "text": "Tu-ntinzi masa Ta\nChiar sub ochii vrăjmașilor mei;\nCu untdelemn îmi ungi capul;\nPaharul meu e plin de tot.\nDa, numai fericirea mea,\nÎndurarea Ta mă va urma."},
        ]
    }
}

# ─── PPT Binary Parsing (from rebuild_icc_from_ppt.py) ───

TEXT_HEADER = 3999
TEXT_CHARS = 4000
TEXT_BYTES = 4008
SLIDE_PERSIST = 1011
SLIDE_LIST_WITH_TEXT = 4080
TEXT_TYPES_PREFERRED = {1, 5, 7, 8}


def norm_line(s):
    s = s.replace("\t", " ")
    s = re.sub(r" {2,}", " ", s)
    return s.strip()


def clean_text(s):
    s = s.replace("\x00", "").replace("\x0b", "\n").replace("\r\n", "\n").replace("\r", "\n")
    lines = [norm_line(x) for x in s.split("\n")]
    lines = [x for x in lines if x]
    return "\n".join(lines).strip()


def read_rec(buf, off):
    if off + 8 > len(buf):
        return None
    rec_ver_inst = struct.unpack_from("<H", buf, off)[0]
    rec_ver = rec_ver_inst & 0x0F
    rec_type = struct.unpack_from("<H", buf, off + 2)[0]
    rec_len = struct.unpack_from("<I", buf, off + 4)[0]
    start = off + 8
    end = start + rec_len
    if end > len(buf):
        return None
    return {
        "recVer": rec_ver,
        "recType": rec_type,
        "recLen": rec_len,
        "contentStart": start,
        "contentEnd": end,
        "recInstance": rec_ver_inst >> 4,
    }


def walk_records(buf, start, end, cb):
    i = start
    while i + 8 <= end:
        rec = read_rec(buf, i)
        if not rec or rec["contentEnd"] > end:
            break
        cb(rec)
        if (rec["recVer"] & 0x0F) == 15:
            walk_records(buf, rec["contentStart"], rec["contentEnd"], cb)
        i = rec["contentEnd"]


def extract_slide_list_with_text(buf):
    found = None
    def cb(rec):
        nonlocal found
        if rec["recType"] == SLIDE_LIST_WITH_TEXT and rec["recInstance"] == 0 and rec["recVer"] == 15:
            found = buf[rec["contentStart"]:rec["contentEnd"]]
    walk_records(buf, 0, len(buf), cb)
    return found


def parse_ppt_slides_from_stream(buf):
    slwt = extract_slide_list_with_text(buf)
    if not slwt:
        raise ValueError("No SlideListWithText")

    slides = []
    cur = None
    text_type = None
    acc = []

    def flush():
        nonlocal acc
        if not cur or text_type is None or not acc:
            acc = []
            return
        txt = clean_text("".join(acc))
        if txt:
            cur["textBlocks"].append({"textType": text_type, "text": txt})
        acc = []

    i = 0
    while i + 8 <= len(slwt):
        rec = read_rec(slwt, i)
        if not rec:
            break
        rt = rec["recType"]
        if rt == SLIDE_PERSIST:
            flush()
            text_type = None
            cur = {"textBlocks": []}
            slides.append(cur)
        elif rt == TEXT_HEADER:
            flush()
            if cur and rec["recLen"] >= 4:
                text_type = struct.unpack_from("<I", slwt, rec["contentStart"])[0]
            else:
                text_type = None
        elif rt == TEXT_CHARS:
            if cur and text_type is not None:
                acc.append(slwt[rec["contentStart"]:rec["contentEnd"]].decode("utf-16-le", errors="replace"))
        elif rt == TEXT_BYTES:
            if cur and text_type is not None:
                acc.append(slwt[rec["contentStart"]:rec["contentEnd"]].decode("latin1", errors="replace"))
        i = rec["contentEnd"]

    flush()
    slides = [s for s in slides if any((b.get("text") or "").strip() for b in s.get("textBlocks", []))]
    return slides


def slide_lines(slide):
    blocks = [
        {"textType": b.get("textType"), "text": clean_text(b.get("text", ""))}
        for b in slide.get("textBlocks", [])
        if clean_text(b.get("text", ""))
    ]
    preferred = [b for b in blocks if b.get("textType") in TEXT_TYPES_PREFERRED]
    use = preferred if preferred else blocks
    out = []
    for b in use:
        out.extend([norm_line(x) for x in b["text"].split("\n") if norm_line(x)])
    return out


def detect_section_type(lines):
    if not lines:
        return "strofa"
    first = lines[0].strip()
    if re.match(r"^\s*R\.?\s*$", first, re.I) or re.match(r"^\s*refren:?\s*$", first, re.I) or re.match(r"^\s*R\.?\s+", first, re.I):
        return "refren"
    return "strofa"


def clean_title_from_lines(lines, fallback):
    if not lines:
        return fallback
    first = re.sub(r"^\d+\s*[.)\-]?\s*", "", lines[0]).strip()
    if first:
        short = re.sub(r"\s+", " ", first).strip().rstrip(".!?")
        if 2 <= len(short) <= 80:
            return short
    raw = re.sub(r"\s+", " ", " ".join(lines[:2])).strip()
    title = re.sub(r"^\d+\s*[.)\-]?\s*", "", raw).strip()
    if len(title) > 90:
        title = title[:90].rsplit(" ", 1)[0]
    return title if title else fallback


def parse_ppt_fallback_03ee(file_path):
    with olefile.OleFileIO(file_path) as ole:
        if not ole.exists("PowerPoint Document"):
            raise ValueError("No PowerPoint Document stream")
        data = ole.openstream("PowerPoint Document").read()

    def scan_texts(start, end, depth=0):
        out = []
        if depth > 20:
            return out
        i = start
        while i + 8 <= end:
            rec = read_rec(data, i)
            if not rec or rec["contentEnd"] > end:
                break
            if rec["recType"] == 0x0FA0 and rec["recLen"] >= 2:
                try:
                    txt = data[rec["contentStart"]:rec["contentEnd"]].decode("utf-16-le", errors="replace")
                    lines = [norm_line(x) for x in txt.split("\x0b") if norm_line(x)]
                    if lines:
                        out.append(lines)
                except Exception:
                    pass
            if rec["recVer"] == 15:
                out.extend(scan_texts(rec["contentStart"], rec["contentEnd"], depth + 1))
            i = rec["contentEnd"]
        return out

    slides = []
    i = 0
    while i + 8 <= len(data):
        rec = read_rec(data, i)
        if not rec:
            break
        if rec["recType"] == 0x03EE:
            texts = scan_texts(rec["contentStart"], rec["contentEnd"])
            if texts:
                slides.append(texts[0])
        i = rec["contentEnd"]

    if not slides:
        raise ValueError("No text slides")

    base = os.path.basename(file_path)
    title = clean_title_from_lines(slides[0], os.path.splitext(base)[0])
    number = re.match(r"^(\d+)", base)
    number = number.group(1).zfill(3) if number else os.path.splitext(base)[0]
    sections = [{"type": detect_section_type(lines), "text": "\n".join(lines)} for lines in slides[1:] if lines]
    return {"number": number, "title": title, "sections": sections}


def parse_ppt_file(file_path):
    base = os.path.basename(file_path)
    with olefile.OleFileIO(file_path) as ole:
        if not ole.exists("PowerPoint Document"):
            raise ValueError("No PowerPoint Document stream")
        stream = ole.openstream("PowerPoint Document").read()

    slides = parse_ppt_slides_from_stream(stream)
    if not slides:
        return parse_ppt_fallback_03ee(file_path)

    title_lines = slide_lines(slides[0])
    title = clean_title_from_lines(title_lines, os.path.splitext(base)[0])
    number = re.match(r"^(\d+)", base)
    number = number.group(1).zfill(3) if number else os.path.splitext(base)[0]

    sections = []
    for s in slides[1:]:
        lines = slide_lines(s)
        if lines:
            sections.append({"type": detect_section_type(lines), "text": "\n".join(lines)})

    return {"number": number, "title": title, "sections": sections}


def parse_pptx_file(file_path):
    base = os.path.basename(file_path)
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(file_path, "r") as z:
        slide_paths = [p for p in z.namelist() if re.match(r"^ppt/slides/slide\d+\.xml$", p)]
        slide_paths.sort(key=lambda p: int(re.search(r"slide(\d+)\.xml", p).group(1)))
        if not slide_paths:
            raise ValueError("No slides")

        def read_slide_lines(sp):
            data = z.read(sp)
            root = ET.fromstring(data)
            ns = {
                "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
                "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            }
            boxes = []
            for sp_node in root.findall(".//p:sp", ns):
                y_offset = 0
                off = sp_node.find("./p:spPr/a:xfrm/a:off", ns)
                if off is not None:
                    try:
                        y_offset = int(off.attrib.get("y", "0"))
                    except Exception:
                        y_offset = 0
                tx_body = sp_node.find("./p:txBody", ns)
                if tx_body is None:
                    continue
                paras = []
                for p_node in tx_body.findall("./a:p", ns):
                    text = ""
                    for r_node in p_node.findall("./a:r", ns):
                        t_node = r_node.find("./a:t", ns)
                        if t_node is not None and t_node.text:
                            text += t_node.text
                    for f_node in p_node.findall("./a:fld/a:t", ns):
                        if f_node.text:
                            text += f_node.text
                    text = norm_line(text)
                    if text:
                        paras.append(text)
                if paras:
                    boxes.append((y_offset, paras))
            boxes.sort(key=lambda x: x[0])
            return [line for _, paras in boxes for line in paras if line]

        title_lines = read_slide_lines(slide_paths[0])
        title = clean_title_from_lines(title_lines, os.path.splitext(base)[0])
        number = re.match(r"^(\d+)", base)
        number = number.group(1).zfill(3) if number else os.path.splitext(base)[0]

        sections = []
        for sp in slide_paths[1:]:
            lines = read_slide_lines(sp)
            if lines:
                sections.append({"type": detect_section_type(lines), "text": "\n".join(lines)})

    return {"number": number, "title": title, "sections": sections}


# ─── Main import logic ───

def main():
    db_path = os.path.abspath(DB_PATH)
    print(f"DB: {db_path}")
    print(f"PPT dir: {PPT_DIR}")
    print(f"Mode: {'APPLY' if APPLY else 'DRY RUN'}")
    print(f"Missing hymns to import: {len(MISSING_NUMBERS)}")
    print()

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    cat = cur.execute("SELECT id FROM categories WHERE name = ?", (CATEGORY_NAME,)).fetchone()
    if not cat:
        raise RuntimeError(f"Category '{CATEGORY_NAME}' not found!")
    category_id = cat["id"]

    results = []

    for num_str in MISSING_NUMBERS:
        # Check for manual override first
        db_number = num_str.zfill(3) if num_str.isdigit() else num_str

        # Check if hymn already exists in DB
        existing = cur.execute("SELECT id FROM hymns WHERE number = ? AND category_id = ?", (db_number, category_id)).fetchone()
        if existing:
            print(f"  ⊘ {num_str} (db: {db_number}): already exists (id={existing['id']})")
            results.append({"number": db_number, "status": "exists"})
            continue

        title = None
        sections = None

        if num_str in MANUAL_SECTIONS:
            manual = MANUAL_SECTIONS[num_str]
            title = manual["title"]
            sections = manual["sections"]
            print(f"  ✓ {num_str} → \"{title}\" ({len(sections)} sections) [MANUAL]")
        else:
            # Find the PPT file
            candidates = []
            for ext in [".pptx", ".PPT", ".ppt", ".PPTX"]:
                path = os.path.join(PPT_DIR, num_str + ext)
                if os.path.exists(path):
                    candidates.append(path)

            if not candidates:
                print(f"  ✗ {num_str}: no PPT file found")
                results.append({"number": num_str, "status": "no_file"})
                continue

            file_path = candidates[0]
            fext = os.path.splitext(file_path)[1].lower()

            try:
                if fext in (".ppt",):
                    parsed = parse_ppt_file(file_path)
                else:
                    parsed = parse_pptx_file(file_path)

                title = parsed["title"]
                sections = parsed["sections"]

                # Apply title overrides
                if num_str in TITLE_OVERRIDES:
                    title = TITLE_OVERRIDES[num_str]

                if not sections:
                    print(f"  ⚠ {num_str}: parsed but no sections found (title: {title})")
                    results.append({"number": num_str, "status": "no_sections", "title": title})
                    continue

                print(f"  ✓ {num_str} → \"{title}\" ({len(sections)} sections)")
                for i, s in enumerate(sections):
                    first_line = s["text"].split("\n")[0][:60]
                    print(f"      [{s['type']}] {first_line}...")

            except Exception as e:
                print(f"  ✗ {num_str}: parse error: {e}")
                results.append({"number": num_str, "status": "error", "error": str(e)})
                continue

        if not title or not sections:
            continue

        search_text = "\n".join([db_number, title, *[s["text"] for s in sections]]).lower()

        if APPLY:
            cur.execute(
                "INSERT INTO hymns (number, title, search_text, category_id) VALUES (?, ?, ?, ?)",
                (db_number, title, search_text, category_id)
            )
            hymn_id = cur.lastrowid
            for idx, sec in enumerate(sections):
                cur.execute(
                    "INSERT INTO hymn_sections (hymn_id, order_index, type, text) VALUES (?, ?, ?, ?)",
                    (hymn_id, idx, sec["type"], sec["text"])
                )

        results.append({"number": db_number, "status": "imported" if APPLY else "ready", "title": title, "sections": len(sections)})

    if APPLY:
        con.commit()
        print(f"\n✅ Committed {sum(1 for r in results if r['status'] == 'imported')} new hymns to DB")
    else:
        print(f"\n🔍 Dry run: {sum(1 for r in results if r['status'] == 'ready')} hymns ready to import")
        print("   Run with --apply to actually insert them")

    # Final count
    total = cur.execute("SELECT COUNT(*) as c FROM hymns WHERE category_id = ?", (category_id,)).fetchone()["c"]
    print(f"   Total hymns in '{CATEGORY_NAME}': {total}")

    con.close()


if __name__ == "__main__":
    main()
