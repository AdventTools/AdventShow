import fs from 'fs/promises';
import JSZip from 'jszip';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { bulkInsertHymns, HymnImportData } from './db';

// ─────────────────────────────────────────────────────────────────────────────
// Shape — one text box extracted from a slide
// ─────────────────────────────────────────────────────────────────────────────

interface Shape {
  paragraphs: string[];  // one entry per <a:p>, joined runs
  area: number;          // cx * cy in EMU² — used to pick the "largest" shape
  yOffset: number;       // top-left Y in EMU
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse ALL text shapes from a slide XML
// Returns shapes with their position, size, and per-paragraph texts
// ─────────────────────────────────────────────────────────────────────────────

async function parseShapes(zip: JSZip, filename: string): Promise<Shape[]> {
  try {
    const xmlContent = await zip.file(filename)?.async('string');
    if (!xmlContent) return [];

    const result = await parseStringPromise(xmlContent, { explicitArray: true });
    const shapes: Shape[] = [];

    // Walk: p:sld → p:cSld → p:spTree → p:sp[]
    const spTree = result?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0];
    if (!spTree) return [];

    const spList: any[] = spTree['p:sp'] ?? [];

    for (const sp of spList) {
      // Position & size
      const xfrm = sp?.['p:spPr']?.[0]?.['a:xfrm']?.[0];
      const ext   = xfrm?.['a:ext']?.[0]?.['$'];
      const off   = xfrm?.['a:off']?.[0]?.['$'];
      const cx    = parseInt(ext?.cx ?? '0');
      const cy    = parseInt(ext?.cy ?? '0');
      const area  = cx * cy;
      const yOffset = parseInt(off?.y ?? '0');

      // Paragraphs
      const txBody = sp?.['p:txBody']?.[0];
      if (!txBody) continue;

      const paras: any[] = txBody['a:p'] ?? [];
      const paragraphs: string[] = [];

      for (const para of paras) {
        let text = '';
        // Text runs
        const runs: any[] = para['a:r'] ?? [];
        for (const run of runs) {
          const t = run['a:t'];
          if (Array.isArray(t))     text += t.map(String).join('');
          else if (typeof t === 'string') text += t;
          else if (t?._)            text += String(t._);
        }
        // Fields (e.g. link text)
        const fields: any[] = para['a:fld'] ?? [];
        for (const fld of fields) {
          const t = fld['a:t'];
          if (Array.isArray(t))     text += t.map(String).join('');
          else if (typeof t === 'string') text += t;
        }
        paragraphs.push(text.trim());
      }

      if (paragraphs.some(p => p.length > 0)) {
        shapes.push({ paragraphs, area, yOffset });
      }
    }

    return shapes;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer detection
// Footers live at the bottom 15% of the slide OR match known text patterns
// Standard slide height (EMU): 6858000
// ─────────────────────────────────────────────────────────────────────────────

const SLIDE_HEIGHT_EMU = 6858000;

const FOOTER_PATTERNS = [
  /imnuri\s*cre[șs]tine/i,
  /imnuri\s*cre/i,
  /\/\d{3,}/,
];

function isFooter(shape: Shape): boolean {
  if (shape.yOffset > SLIDE_HEIGHT_EMU * 0.85) return true;
  const allText = shape.paragraphs.join(' ');
  return FOOTER_PATTERNS.some(p => p.test(allText));
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalize
// ─────────────────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Title slide: find shape containing "Imnul" → extract digits for number
//              other shape(s) → title text
// ─────────────────────────────────────────────────────────────────────────────

function extractTitle(shapes: Shape[]): { number: string; title: string } {
  let number = '';
  let title = '';

  for (const shape of shapes) {
    const allText = shape.paragraphs.join(' ').trim();

    if (/imnul/i.test(allText)) {
      // Extract all digit sequences and join (handles "Imnul 2 3" → "23")
      const digits = allText.match(/\d+/g);
      if (digits) number = digits.join('');
    } else {
      const candidate = normalize(allText);
      if (candidate && candidate.length > title.length) {
        title = candidate;
      }
    }
  }

  return { number, title };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker patterns
// ─────────────────────────────────────────────────────────────────────────────

/** "R."  "R"  "r."  "r."  alone on a line (the marker itself, no following text) */
const R_ALONE   = /^\s*R\.?\s*$/i;

/** "R. O, ce har..."  — marker followed immediately by refren text on the same line */
const R_INLINE  = /^\s*R\.?\s+(.+)$/i;

/** "Refren"  "REFREN"  "Refren:"  alone */
const REFREN_WORD = /^\s*refren:?\s*$/i;

/** "1."  "2."  "Strofa 1"  "Strofa 2" — stanza header */
const STROFA_HDR  = /^\s*(strofa\s*)?\d+\.?\s*$/i;

// ─────────────────────────────────────────────────────────────────────────────
// processLines — state machine that splits a flat list of lines into
// {type, text} sections, recognising all marker variants
// ─────────────────────────────────────────────────────────────────────────────

function processLines(lines: string[]): { type: 'strofa' | 'refren'; text: string }[] {
  const out: { type: 'strofa' | 'refren'; text: string }[] = [];
  let mode: 'strofa' | 'refren' = 'strofa';
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ type: mode, text });
    buf = [];
  };

  for (const line of lines) {
    // ── Standalone R. marker ─────────────────────────────────────────────────
    if (R_ALONE.test(line) || REFREN_WORD.test(line)) {
      flush();
      mode = 'refren';
      continue;
    }

    // ── Inline R. marker + first refren line e.g. "R. Binecuvântat ești Tu" ─
    const inlineMatch = line.match(R_INLINE);
    if (inlineMatch) {
      flush();
      mode = 'refren';
      buf.push(inlineMatch[1].trim()); // text after "R. "
      continue;
    }

    // ── Stanza number header — "1."  "Strofa 2" etc. ───────────────────────
    if (STROFA_HDR.test(line)) {
      flush();
      mode = 'strofa';
      continue; // header itself not stored
    }

    buf.push(line);
  }

  flush();
  return out;
}



export async function importPPTXFiles(
  filePaths: string[],
  categoryId?: number
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  const batch: HymnImportData[] = [];
  const pptxFiles = filePaths.filter(p => p.toLowerCase().endsWith('.pptx'));

  try {
    for (const filePath of pptxFiles) {
      const file = path.basename(filePath);
      try {
        const fileBuffer = await fs.readFile(filePath);
        const zip = await JSZip.loadAsync(fileBuffer);

        // Sort slides by index number
        const slideFiles = Object.keys(zip.files)
          .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
          .sort((a, b) => {
            const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0');
            const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0');
            return na - nb;
          });

        if (slideFiles.length === 0) continue;

        // ── SLIDE 1: Title ─────────────────────────────────────────────────
        const slide1Shapes = await parseShapes(zip, slideFiles[0]);
        const contentShapes1 = slide1Shapes.filter(s => !isFooter(s));
        const info = extractTitle(contentShapes1);

        // Fallback: use filename digits
        if (!info.number) {
          const m = file.match(/^(\d+)/);
          if (m) info.number = m[1];
        }
        if (!info.title) {
          info.title = path.basename(file, path.extname(file));
        }

        // ── SLIDES 2+: Lyrics ──────────────────────────────────────────────
        const sections: { type: 'strofa' | 'refren'; text: string }[] = [];

        for (let i = 1; i < slideFiles.length; i++) {
          const shapes = await parseShapes(zip, slideFiles[i]);

          // Keep only non-footer shapes, sorted top-to-bottom
          const contentShapes = shapes
            .filter(s => !isFooter(s))
            .sort((a, b) => a.yOffset - b.yOffset);

          if (contentShapes.length === 0) continue;

          // Gather ALL paragraphs across ALL shapes in reading order
          const allLines: string[] = [];
          for (const shape of contentShapes) {
            for (const p of shape.paragraphs) {
              const line = normalize(p);
              if (line.length > 0) allLines.push(line);
            }
          }

          if (allLines.length === 0) continue;

          // Run through the unified state machine
          const slideResult = processLines(allLines);
          sections.push(...slideResult);
        }

        // ── Deduplicate consecutive identical refrens ───────────────────────
        const deduped: typeof sections = [];
        for (const s of sections) {
          const prev = deduped[deduped.length - 1];
          if (prev && prev.type === s.type && prev.text.trim() === s.text.trim()) continue;
          deduped.push(s);
        }

        if (!info.number || !info.title || deduped.length === 0) {
          errors.push(`Skipped ${file}: missing number, title, or sections`);
          failed++;
          continue;
        }

        const allText = deduped.map(s => s.text).join(' ');
        const searchText = `${info.number} ${info.title} ${allText}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        batch.push({
          number: info.number,
          title: info.title,
          searchText,
          categoryId,
          sections: deduped,
        });
        success++;

      } catch (err: any) {
        console.error(`Error processing ${file}:`, err);
        failed++;
        errors.push(`${file}: ${err?.message ?? 'Unknown error'}`);
      }
    }

    if (batch.length > 0) {
      bulkInsertHymns(batch);
    }
  } catch (err: any) {
    console.error('Error importing PPTX files:', err);
    throw err;
  }

  return { success, failed, errors };
}

export async function importPPTXDirectory(
  dirPath: string,
  categoryId?: number
): Promise<{ success: number; failed: number; errors: string[] }> {
  try {
    const files = await fs.readdir(dirPath);
    const filePaths = files
      .filter(f => f.toLowerCase().endsWith('.pptx'))
      .map(f => path.join(dirPath, f));
    return await importPPTXFiles(filePaths, categoryId);
  } catch (err: any) {
    console.error('Error reading directory:', err);
    throw err;
  }
}
