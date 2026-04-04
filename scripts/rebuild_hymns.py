#!/usr/bin/env python3
"""
Rebuild the hymns database entirely from PPT/PPTX source files.

Reads all_hymns_raw.json (pre-extracted text from 920 PPT/PPTX files),
parses title, stanzas, and refrains using pattern recognition,
then rebuilds the hymns + hymn_sections tables in hymns.db.

Bible data and categories are preserved.
"""

import json, re, sqlite3, sys
from pathlib import Path
from collections import Counter

SCRIPT_DIR = Path(__file__).parent
RAW_JSON   = SCRIPT_DIR / "all_hymns_raw.json"
DB_PATH    = SCRIPT_DIR / ".." / "public" / "hymns.db"

VT = "\x0b"; CR = "\r"; LF = "\n"; TAB = "\t"


def normalize(text):
    text = text.replace(VT, "\n").replace(CR, "\n").replace(TAB, " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = "\n".join(l.rstrip() for l in text.split("\n"))
    return text.strip()


def csp(text):
    return re.sub(r"  +", " ", text)


def clean(text):
    return csp(normalize(text))


def strip_num(text):
    """Remove leading 'N. ' or '. ' prefix from stanza text."""
    return re.sub(r"^\.?\s*\d*\.?\s*", "", text, count=1).strip()


def flat(b):
    return csp(b.replace(VT, " ").replace(CR, " ").replace(LF, " ")).strip()


# ── Classifiers ───────────────────────────────────────────────────────
MASTER_RE = re.compile(r"Click to edit Master")
STANZA_RE = re.compile(r"^(\d+)\.\s")
TITLE_RE  = re.compile(r"^(\d+)\.\s+(.+)")
RL = "Refren:"


def is_bp(b):
    s = b.strip()
    return MASTER_RE.search(s) is not None or s == "*"


def is_rl(b):
    return b.strip() == RL


def is_inline_ref(b):
    s = b.strip()
    return s.startswith(RL) and len(s) > 10


def is_footer(b):
    s = b.strip()
    return bool(re.match(r"^\d+/\d+$", s)) or "IMNURI CRE" in s.upper()


def extract_title(b, max_len=120):
    f = flat(b)
    if len(f) > max_len:
        return None
    m = TITLE_RE.match(f)
    return (int(m.group(1)), m.group(2).strip()) if m else None


# ── Single-slide PPT ──────────────────────────────────────────────────
def parse_single_slide(blocks, file_num):
    title = None
    stanzas = []
    ref_candidates = []

    for b in blocks:
        if is_bp(b):
            continue
        if is_rl(b):
            continue

        if is_inline_ref(b):
            text = clean(b.strip()[len(RL):])
            if text:
                ref_candidates.append(text)
            continue

        p = extract_title(b, max_len=55)
        if p and len(flat(b)) < 55:
            tn, tt = p
            if tn == file_num or title is None:
                title = (tn, tt)
            continue

        c = clean(b)
        m = STANZA_RE.match(c)
        if m:
            snum = int(m.group(1))
            text = strip_num(c)
            if text and len(text) > 8:
                stanzas.append((snum, text))
            continue

        if c and len(c) > 8:
            ref_candidates.append(c)

    # Refrain = most repeated non-stanza block
    refrain = None
    if ref_candidates:
        counts = Counter(ref_candidates)
        mc = counts.most_common(1)[0]
        if mc[1] >= 2:
            refrain = mc[0]
        elif len(stanzas) > 0 and len(ref_candidates) == len(stanzas):
            refrain = ref_candidates[0]

    return title, stanzas, refrain


# ── Multi-slide PPT ──────────────────────────────────────────────────
def parse_multi_slide(slides, file_num, masters):
    mset = set(masters)

    # ── Phase 1: Find the metadata boundary on each master slide ──
    # On each master slide, blocks BEFORE "Click to edit Master" are content,
    # blocks FROM "Click to edit Master" onward are metadata.
    meta_start = {}  # master_slide_idx → first metadata block index
    for mi in masters:
        sl = slides[mi]
        cut = len(sl)
        for j, b in enumerate(sl):
            if MASTER_RE.search(b):
                cut = j
                break
        meta_start[mi] = cut

    # ── Phase 2: Identify title blocks ──
    # Title blocks appear in metadata sections (short numbered blocks)
    # and on multi-block non-master slides (multi-hymn transition slides).
    title_blocks = []  # (slide_idx, block_idx, num, text)

    for mi in masters:
        sl = slides[mi]
        for j in range(meta_start[mi], len(sl)):
            b = sl[j]
            if is_bp(b) or is_rl(b):
                continue
            p = extract_title(b, max_len=55)
            if p:
                title_blocks.append((mi, j, p[0], p[1]))

    for i, sl in enumerate(slides):
        if i in mset:
            continue
        if len(sl) <= 1:
            continue  # Regular content slide with 1 block
        for j, b in enumerate(sl):
            p = extract_title(b, max_len=55)
            if p:
                title_blocks.append((i, j, p[0], p[1]))

    # ── Phase 3: Select title ──
    title = None
    # Prefer LAST match for file_num
    for si, bi, tn, tt in reversed(title_blocks):
        if tn == file_num:
            title = (tn, tt)
            break
    if title is None and title_blocks:
        # Fallback: use any title (e.g., 568 where number is 567)
        title = (title_blocks[-1][2], title_blocks[-1][3])

    skip_blocks = set((si, bi) for si, bi, _, _ in title_blocks)

    # ── Phase 4: Extract refrain ──
    # Search slides that contain title blocks matching file_num first,
    # then fall back to master slides.
    own_slides = sorted(set(si for si, bi, tn, tt in title_blocks if tn == file_num))
    refrain_slides = own_slides if own_slides else sorted(mset)

    refrain = None
    for ri in refrain_slides:
        sl = slides[ri]
        for j in range(len(sl)):
            if is_rl(sl[j]) and j + 1 < len(sl):
                nxt = clean(sl[j + 1])
                if nxt and len(nxt) > 8 and not is_bp(sl[j + 1]) and not is_rl(sl[j + 1]) and not STANZA_RE.match(nxt):
                    if refrain is None:
                        refrain = nxt
            if is_inline_ref(sl[j]):
                txt = clean(sl[j].strip()[len(RL):])
                if txt and refrain is None:
                    refrain = txt
        if refrain:
            break

    # Fallback: search the last slide (often has refrain blocks even without "Click to edit Master")
    if refrain is None:
        for i in range(len(slides) - 1, -1, -1):
            sl = slides[i]
            for j in range(len(sl)):
                if is_rl(sl[j]) and j + 1 < len(sl):
                    nxt = clean(sl[j + 1])
                    if nxt and len(nxt) > 8 and not is_bp(sl[j + 1]) and not is_rl(sl[j + 1]) and not STANZA_RE.match(nxt):
                        refrain = nxt
                        break
                if is_inline_ref(sl[j]):
                    txt = clean(sl[j].strip()[len(RL):])
                    if txt:
                        refrain = txt
                        break
            if refrain:
                break

    # ── Phase 5: Extract stanzas ──
    all_stanzas = []
    for i, sl in enumerate(slides):
        for j, b in enumerate(sl):
            if (i, j) in skip_blocks:
                continue
            if is_bp(b) or is_rl(b) or is_inline_ref(b):
                continue
            c = clean(b)
            if refrain and c == refrain:
                continue
            m = STANZA_RE.match(c)
            if m:
                snum = int(m.group(1))
                text = strip_num(c)
                if text and len(text) > 8 and snum <= 20:
                    # Skip garbage blocks (collapsed text still starting with number)
                    if re.match(r"^\d+\.\s", text):
                        continue
                    all_stanzas.append((i, snum, text))

    # For multi-hymn files: limit stanzas to the correct hymn's section
    all_hymn_nums = set(tn for _, _, tn, _ in title_blocks)
    if file_num in all_hymn_nums and len(all_hymn_nums) > 1:
        other_title_slides = [si for si, bi, tn, tt in title_blocks if tn != file_num]
        if other_title_slides:
            boundary = max(other_title_slides) + 1
            all_stanzas = [(i, snum, text) for i, snum, text in all_stanzas if i >= boundary]

    # Take LAST occurrence of each stanza number
    smap = {}
    for _, snum, text in all_stanzas:
        if snum > 0:
            smap[snum] = text
    stanzas = [(k, smap[k]) for k in sorted(smap.keys())]

    if not stanzas:
        for i, sl in enumerate(slides):
            if i in mset:
                continue
            for b in sl:
                c = clean(b)
                if c and len(c) > 15 and not is_bp(b):
                    stanzas.append((0, c))

    return title, stanzas, refrain


# ── PPT entry ─────────────────────────────────────────────────────────
def parse_ppt(fnum, data):
    slides = data["slides"]
    ni = int(fnum)
    masters = [i for i, sl in enumerate(slides) if any(MASTER_RE.search(b) for b in sl)]

    if data["num_slides"] == 1:
        title, stanzas, refrain = parse_single_slide(slides[0], ni)
    else:
        title, stanzas, refrain = parse_multi_slide(slides, ni, masters)

    if not stanzas:
        for sl in slides:
            for b in sl:
                c = clean(b)
                if c and len(c) > 15 and not is_bp(b):
                    stanzas = [(0, c)]
                    break
            if stanzas:
                break

    if not stanzas:
        print(f"  WARN: {fnum} no stanzas")
        return None

    title_text = title[1] if title else stanzas[0][1].split("\n")[0][:60]
    secs = build_sections([s[1] for s in stanzas], refrain)
    return {"number": fnum, "title": csp(title_text), "sections": secs}


# ── PPTX entry ────────────────────────────────────────────────────────
def parse_pptx(fnum, data):
    slides = data["slides"]
    title_text = None

    for b in (slides[0] if slides else []):
        if "Imnul" in b:
            continue
        p = extract_title(b)
        if p:
            title_text = p[1]
            break
        f = flat(b)
        if f and len(f) < 100:
            title_text = f
            break

    if not title_text:
        title_text = f"Imnul {fnum}"

    stanzas = []
    refrain = None

    for i, sl in enumerate(slides):
        if i == 0:
            continue
        stanza_parts = []
        refrain_parts = []
        in_refrain = False
        has_rl_flag = False

        for b in sl:
            if is_footer(b):
                continue

            # "Refren:" label pattern (PPTX format A, e.g., hymn 644)
            if is_rl(b):
                has_rl_flag = True
                # Refrain is the block BEFORE this "Refren:" label
                if stanza_parts:
                    last = stanza_parts[-1]
                    c = clean(last)
                    if c and not STANZA_RE.match(c):
                        if refrain is None:
                            refrain = c
                        stanza_parts.pop()
                continue

            # "R." prefix pattern (PPTX format B, hymns 737-920)
            s = b.strip()
            if re.match(r"^R\.\s", s):
                in_refrain = True
                refrain_parts.append(re.sub(r"^R\.\s*", "", s))
                continue

            # Blocks after R. are refrain continuation
            if in_refrain:
                refrain_parts.append(b.strip())
                continue

            stanza_parts.append(b)

        # Extract refrain from R. blocks + continuation
        if refrain_parts and refrain is None:
            refrain = csp("\n".join(refrain_parts)).strip()

        if not stanza_parts:
            continue

        # Combine blocks into stanza text
        lines = []
        for b in stanza_parts:
            txt = b.replace(VT, "\n").replace(CR, "\n").replace(TAB, " ").strip()
            if txt:
                lines.append(txt)
        if lines:
            combined = strip_num(csp("\n".join(lines)).strip())
            if combined:
                stanzas.append(combined)

    if not stanzas:
        print(f"  WARN: {fnum} (pptx) no stanzas")
        return None

    secs = build_sections(stanzas, refrain)
    return {"number": fnum, "title": csp(title_text), "sections": secs}


# ── Build sections ────────────────────────────────────────────────────
def build_sections(stanzas, refrain):
    secs = []
    for text in stanzas:
        secs.append({"type": "strofa", "text": text})
        if refrain:
            secs.append({"type": "refren", "text": refrain})
    return secs


# ── Parse all ─────────────────────────────────────────────────────────
def parse_all(raw):
    hr = raw["hymns"]
    results, errors = [], []
    for fn in sorted(hr.keys(), key=lambda x: int(x)):
        h = hr[fn]
        try:
            p = parse_ppt(fn, h) if h["format"] == "ppt" else parse_pptx(fn, h)
            if p:
                results.append(p)
            else:
                errors.append(fn)
        except Exception as e:
            print(f"  ERROR {fn}: {e}")
            import traceback; traceback.print_exc()
            errors.append(fn)
    print(f"\nParsed {len(results)}/{len(hr)}, errors: {len(errors)}")
    if errors:
        print(f"  {errors}")
    return results


# ── DB rebuild ────────────────────────────────────────────────────────
def rebuild_database(hymns, db_path):
    db = sqlite3.connect(str(db_path))
    c = db.cursor()
    c.execute("SELECT id FROM categories WHERE id=1")
    if not c.fetchone():
        c.execute("INSERT INTO categories (id,name) VALUES (1,'Imnuri Creștine')")
    c.execute("DELETE FROM hymn_sections")
    c.execute("DELETE FROM hymns")
    for h in hymns:
        dn = h["number"].lstrip("0") or "0"
        c.execute("INSERT INTO hymns (number,title,category_id) VALUES (?,?,1)", (dn, h["title"]))
        hid = c.lastrowid
        for idx, s in enumerate(h["sections"]):
            c.execute("INSERT INTO hymn_sections (hymn_id,type,text,order_index) VALUES (?,?,?,?)",
                      (hid, s["type"], s["text"], idx))
    db.commit()
    t = c.execute("SELECT COUNT(*) FROM hymns").fetchone()[0]
    ss = c.execute("SELECT COUNT(*) FROM hymn_sections").fetchone()[0]
    st = c.execute("SELECT COUNT(*) FROM hymn_sections WHERE type='strofa'").fetchone()[0]
    rf = c.execute("SELECT COUNT(*) FROM hymn_sections WHERE type='refren'").fetchone()[0]
    print(f"\nDB rebuilt: {t} hymns, {ss} sections ({st} strofe, {rf} refrene)")
    db.close()


# ── Validate ──────────────────────────────────────────────────────────
def validate(hymns):
    hm = {h["number"]: h for h in hymns}
    checks = [
        "001", "002", "003", "014", "019", "024", "027", "029", "047",
        "072", "080", "099", "102", "115", "150", "190", "229",
        "338", "343", "370", "443", "500", "568",
        "633", "641", "644", "645",
        "737", "738", "743", "749", "750", "751", "754",
        "804", "843", "853", "869",
    ]

    for n in checks:
        h = hm.get(n)
        if not h:
            print(f"\n  {n}: *** MISSING ***")
            continue
        st = [s for s in h["sections"] if s["type"] == "strofa"]
        rf = [s for s in h["sections"] if s["type"] == "refren"]
        print(f"\n  {n}. {h['title'][:50]}  [{len(st)}S {len(rf)}R]")
        for i, s in enumerate(h["sections"][:8]):
            pv = s["text"][:70].replace("\n", " / ")
            print(f"    [{i}] {s['type']:6s}: {pv}")
        if len(h["sections"]) > 8:
            print(f"    ... ({len(h['sections']) - 8} more)")

    print(f"\n{'=' * 60}\nQUALITY:")
    probs = []
    for h in hymns:
        n = h["number"]
        for s in h["sections"]:
            if s["type"] == "refren" and re.match(r"^\d+\.\s", s["text"]):
                probs.append((n, "refren starts with number"))
                break
        for s in h["sections"]:
            if s["type"] == "strofa" and "Refren:" in s["text"]:
                probs.append((n, "strofa has Refren:"))
                break
        for s in h["sections"]:
            if s["type"] == "strofa" and s["text"].startswith("R."):
                probs.append((n, "strofa starts with R."))
                break
        st = [s for s in h["sections"] if s["type"] == "strofa"]
        if len(st) == 1:
            # Check if it might be missing stanzas (only flag non-canons)
            if "(canon)" not in h["title"].lower() and "canon" not in st[0]["text"].lower()[:30]:
                if "(:Cu Tine" not in st[0]["text"][:30] and "(:Amin" not in st[0]["text"][:30]:
                    pass  # Don't flag - many short hymns are genuinely 1 stanza

    with_refrain = sum(1 for h in hymns if any(s["type"] == "refren" for s in h["sections"]))
    avg_stanzas = sum(len([s for s in h["sections"] if s["type"] == "strofa"]) for h in hymns) / len(hymns)
    print(f"  Hymns: {len(hymns)}, Problems: {len(probs)}")
    print(f"  With refrain: {with_refrain}, Avg stanzas: {avg_stanzas:.1f}")
    for n, iss in sorted(probs):
        print(f"    {n}: {iss}")


def main():
    print("Loading...")
    raw = json.load(open(RAW_JSON, encoding="utf-8"))
    print(f"Parsing {len(raw['hymns'])} hymns...")
    hymns = parse_all(raw)

    out = SCRIPT_DIR / "all_hymns_final.json"
    json.dump(hymns, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"Saved to {out}")

    print(f"\n{'=' * 60}\nVALIDATION:")
    validate(hymns)

    if "--rebuild" in sys.argv:
        print(f"\nRebuilding {DB_PATH}...")
        rebuild_database(hymns, DB_PATH)
    else:
        print(f"\nDry run. Use --rebuild to update DB.")


if __name__ == "__main__":
    main()
