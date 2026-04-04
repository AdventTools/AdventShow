import fs from 'node:fs/promises';
import JSZip from 'jszip';
import path from 'node:path';
import * as CFB from 'cfb';
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

interface PptRecordHeader {
  recVer: number;
  recInstance: number;
  recType: number;
  recLen: number;
  contentStart: number;
  contentEnd: number;
}

interface LegacyPptTextBlock {
  textType: number;
  text: string;
}

interface LegacyPptSlide {
  textBlocks: LegacyPptTextBlock[];
}

const SUPPORTED_POWERPOINT_EXTENSIONS = new Set(['.ppt', '.pptx']);
const PPT_RECORD_TYPE_SLIDE_PERSIST_ATOM = 1011;
const PPT_RECORD_TYPE_TEXT_HEADER_ATOM = 3999;
const PPT_RECORD_TYPE_TEXT_CHARS_ATOM = 4000;
const PPT_RECORD_TYPE_TEXT_BYTES_ATOM = 4008;
const PPT_RECORD_TYPE_SLIDE_LIST_WITH_TEXT = 4080;
const PPT_TEXT_TYPE_TITLE = 0;
const PPT_TEXT_TYPE_BODY = 1;
const PPT_TEXT_TYPE_CENTER_BODY = 5;
const PPT_TEXT_TYPE_CENTER_TITLE = 6;
const PPT_TEXT_TYPE_HALF_BODY = 7;
const PPT_TEXT_TYPE_QUARTER_BODY = 8;
const LEGACY_PPT_TITLE_TYPES = new Set([PPT_TEXT_TYPE_TITLE, PPT_TEXT_TYPE_CENTER_TITLE]);
const LEGACY_PPT_BODY_TYPES = new Set([
  PPT_TEXT_TYPE_BODY,
  PPT_TEXT_TYPE_CENTER_BODY,
  PPT_TEXT_TYPE_HALF_BODY,
  PPT_TEXT_TYPE_QUARTER_BODY,
]);

function isPowerPointFile(filePath: string): boolean {
  return SUPPORTED_POWERPOINT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getPowerPointFiles(filePaths: string[]): string[] {
  return filePaths.filter(isPowerPointFile);
}

function readPptRecordHeader(data: Buffer, offset: number): PptRecordHeader | null {
  if (offset + 8 > data.length) return null;
  const rec = data.readUInt16LE(offset);
  const recVer = rec & 0x000f;
  const recInstance = rec >>> 4;
  const recType = data.readUInt16LE(offset + 2);
  const recLen = data.readUInt32LE(offset + 4);
  const contentStart = offset + 8;
  const contentEnd = contentStart + recLen;
  if (contentEnd > data.length) return null;
  return { recVer, recInstance, recType, recLen, contentStart, contentEnd };
}

function walkPptRecords(
  data: Buffer,
  start: number,
  end: number,
  visitor: (record: PptRecordHeader) => void,
) {
  let offset = start;
  while (offset + 8 <= end) {
    const record = readPptRecordHeader(data, offset);
    if (!record || record.contentEnd > end) break;
    visitor(record);
    if (record.recVer === 0x0f) {
      walkPptRecords(data, record.contentStart, record.contentEnd, visitor);
    }
    offset = record.contentEnd;
  }
}

function normalizeLegacyPptText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\u000b/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => normalize(line))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isLikelyFooterText(text: string): boolean {
  return FOOTER_PATTERNS.some(pattern => pattern.test(text));
}

function dedupeSections(sections: { type: 'strofa' | 'refren'; text: string }[]) {
  const deduped: typeof sections = [];
  for (const section of sections) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.type === section.type && prev.text.trim() === section.text.trim()) continue;
    deduped.push(section);
  }
  return deduped;
}

function buildImportData(
  info: { number: string; title: string },
  sections: { type: 'strofa' | 'refren'; text: string }[],
  categoryId?: number,
): HymnImportData {
  if (!info.number) {
    throw new Error('Nu am putut determina numărul imnului din slide-ul de titlu sau din numele fișierului.');
  }
  if (!info.title) {
    throw new Error('Nu am putut determina titlul imnului.');
  }
  if (sections.length === 0) {
    throw new Error('Nu am putut extrage secțiuni din slide-urile prezentării.');
  }

  const allText = sections.map(section => section.text).join(' ');
  const searchText = `${info.number} ${info.title} ${allText}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return {
    number: info.number,
    title: info.title,
    searchText,
    categoryId,
    sections,
  };
}

function getLegacyPptSlideListContent(data: Buffer): Buffer | null {
  let match: Buffer | null = null;
  walkPptRecords(data, 0, data.length, record => {
    if (record.recType === PPT_RECORD_TYPE_SLIDE_LIST_WITH_TEXT && record.recInstance === 0 && record.recVer === 0x0f) {
      match = data.subarray(record.contentStart, record.contentEnd);
    }
  });
  return match;
}

function extractLegacyPptSlides(data: Buffer): LegacyPptSlide[] {
  const slideListContent = getLegacyPptSlideListContent(data);
  if (!slideListContent) {
    throw new Error('Nu am găsit lista de slide-uri în fișierul .ppt.');
  }

  const slides: LegacyPptSlide[] = [];
  let currentSlide: LegacyPptSlide | null = null;
  let currentTextType: number | null = null;
  let currentTextChunks: string[] = [];

  const flushCurrentText = () => {
    if (!currentSlide || currentTextType == null || currentTextChunks.length === 0) {
      currentTextChunks = [];
      return;
    }

    const text = normalizeLegacyPptText(currentTextChunks.join(''));
    if (text) {
      currentSlide.textBlocks.push({ textType: currentTextType, text });
    }
    currentTextChunks = [];
  };

  let offset = 0;
  while (offset + 8 <= slideListContent.length) {
    const record = readPptRecordHeader(slideListContent, offset);
    if (!record) break;

    switch (record.recType) {
      case PPT_RECORD_TYPE_SLIDE_PERSIST_ATOM:
        flushCurrentText();
        currentTextType = null;
        currentSlide = { textBlocks: [] };
        slides.push(currentSlide);
        break;
      case PPT_RECORD_TYPE_TEXT_HEADER_ATOM:
        flushCurrentText();
        currentTextType = currentSlide && record.recLen >= 4
          ? slideListContent.readUInt32LE(record.contentStart)
          : null;
        break;
      case PPT_RECORD_TYPE_TEXT_CHARS_ATOM:
        if (currentSlide && currentTextType != null) {
          currentTextChunks.push(slideListContent.toString('utf16le', record.contentStart, record.contentEnd));
        }
        break;
      case PPT_RECORD_TYPE_TEXT_BYTES_ATOM:
        if (currentSlide && currentTextType != null) {
          currentTextChunks.push(slideListContent.toString('latin1', record.contentStart, record.contentEnd));
        }
        break;
      default:
        break;
    }

    offset = record.contentEnd;
  }

  flushCurrentText();

  return slides.filter(slide =>
    slide.textBlocks.some(block => block.text.length > 0 && !isLikelyFooterText(block.text)),
  );
}

function inferTitleFromLegacyPpt(slide: LegacyPptSlide, file: string) {
  const blocks = slide.textBlocks
    .map(block => ({ ...block, text: normalizeLegacyPptText(block.text) }))
    .filter(block => block.text && !isLikelyFooterText(block.text));

  let number = '';
  let title = '';

  for (const block of blocks) {
    if (/imnul/i.test(block.text)) {
      const digits = block.text.match(/\d+/g);
      if (digits) number = digits.join('');
      continue;
    }

    // Handle "NNN. TITLE" or "NNN TITLE" pattern (e.g. Exploratori PPTs)
    const numberedTitleMatch = block.text.match(/^(\d+)\.?\s+(.+)/);
    if (numberedTitleMatch && !number) {
      number = String(parseInt(numberedTitleMatch[1], 10));
    }

    if (!number && /\d/.test(block.text) && block.text.length <= 24) {
      const digits = block.text.match(/\d+/g);
      if (digits) number = digits.join('');
    }
  }

  const preferredTitleBlocks = blocks.filter(block => LEGACY_PPT_TITLE_TYPES.has(block.textType));
  const titleCandidates = (preferredTitleBlocks.length > 0 ? preferredTitleBlocks : blocks)
    .map(block => block.text)
    .filter(text => !/^imnul\b/i.test(text) && !/^\d+$/.test(text));

  for (const candidate of titleCandidates) {
    // Strip leading "NNN. " or "NNN " prefix from title
    const cleaned = candidate.replace(/^\d+\.?\s+/, '');
    const finalCandidate = cleaned || candidate;
    if (finalCandidate.length > title.length) title = finalCandidate;
  }

  if (!number) {
    const match = file.match(/^(\d+)/);
    if (match) number = match[1];
  }
  if (!title) {
    title = path.basename(file, path.extname(file));
  }

  // Prefer filename title when detected title is ALL CAPS (better casing)
  if (title === title.toUpperCase() && title.length > 2) {
    const fileTitle = path.basename(file, path.extname(file)).replace(/^\d+\.?\s*/, '').trim();
    if (fileTitle) title = fileTitle;
  }

  return { number: String(parseInt(number, 10) || number), title };
}

function getLegacyPptLinesForSlide(slide: LegacyPptSlide): string[] {
  const blocks = slide.textBlocks
    .map(block => ({ ...block, text: normalizeLegacyPptText(block.text) }))
    .filter(block => block.text && !isLikelyFooterText(block.text));

  const preferred = blocks.filter(block => LEGACY_PPT_BODY_TYPES.has(block.textType));
  const candidates = preferred.length > 0 ? preferred : blocks;
  const lines: string[] = [];

  for (const block of candidates) {
    for (const rawLine of block.text.split('\n')) {
      const line = normalize(rawLine);
      if (line) lines.push(line);
    }
  }

  return lines;
}

async function extractLegacyPptImportData(
  pptPath: string,
  sourcePath: string,
  categoryId?: number,
): Promise<HymnImportData> {
  const file = path.basename(sourcePath);
  const buffer = await fs.readFile(pptPath);
  const cfb = CFB.read(buffer, { type: 'buffer' });
  const documentStream = CFB.find(cfb, 'PowerPoint Document');
  if (!documentStream?.content) {
    throw new Error('Nu am găsit fluxul "PowerPoint Document" în fișierul .ppt.');
  }

  const documentBuffer = Buffer.from(documentStream.content);
  const slides = extractLegacyPptSlides(documentBuffer);
  if (slides.length === 0) {
    throw new Error('Nu am găsit slide-uri cu text în fișierul .ppt.');
  }

  const info = inferTitleFromLegacyPpt(slides[0], file);
  const sections: { type: 'strofa' | 'refren'; text: string }[] = [];

  for (let i = 1; i < slides.length; i++) {
    const lines = getLegacyPptLinesForSlide(slides[i]);
    if (lines.length === 0) continue;
    sections.push(...processLines(lines));
  }

  return buildImportData(info, dedupeSections(sections), categoryId);
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
      const ext = xfrm?.['a:ext']?.[0]?.['$'];
      const off = xfrm?.['a:off']?.[0]?.['$'];
      const cx = parseInt(ext?.cx ?? '0');
      const cy = parseInt(ext?.cy ?? '0');
      const area = cx * cy;
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
          if (Array.isArray(t)) text += t.map(String).join('');
          else if (typeof t === 'string') text += t;
          else if (t?._) text += String(t._);
        }
        // Fields (e.g. link text)
        const fields: any[] = para['a:fld'] ?? [];
        for (const fld of fields) {
          const t = fld['a:t'];
          if (Array.isArray(t)) text += t.map(String).join('');
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
const R_ALONE = /^\s*R\.?\s*$/i;

/** "R. O, ce har..."  — marker followed immediately by refren text on the same line */
const R_INLINE = /^\s*R\.?\s+(.+)$/i;

/** "Refren"  "REFREN"  "Refren:"  alone */
const REFREN_WORD = /^\s*refren:?\s*$/i;

/** "1."  "2."  "Strofa 1"  "Strofa 2" — stanza header */
const STROFA_HDR = /^\s*(strofa\s*)?\d+\.?\s*$/i;

/** Inline stanza number at start of a line: "1.  Text..." or "2. Text..." */
const INLINE_STANZA_NUM = /^\d+\.\s+/;

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

    // Strip inline stanza number from first line of a stanza
    // e.g. "1.  Suntem uniţi inimi şi gând," → "Suntem uniţi inimi şi gând,"
    if (buf.length === 0 && mode === 'strofa' && INLINE_STANZA_NUM.test(line)) {
      buf.push(line.replace(INLINE_STANZA_NUM, ''));
    } else {
      buf.push(line);
    }
  }

  flush();
  return out;
}



async function extractPptxImportData(
  pptxPath: string,
  sourcePath: string,
  categoryId?: number,
): Promise<HymnImportData> {
  const file = path.basename(sourcePath);
  const fileBuffer = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(fileBuffer);

  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0');
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0');
      return na - nb;
    });

  if (slideFiles.length === 0) {
    throw new Error('Nu am găsit slide-uri în prezentare.');
  }

  const slide1Shapes = await parseShapes(zip, slideFiles[0]);
  const contentShapes1 = slide1Shapes.filter(s => !isFooter(s));
  const info = extractTitle(contentShapes1);

  if (!info.number) {
    const m = file.match(/^(\d+)/);
    if (m) info.number = m[1];
  }
  if (!info.title) {
    info.title = path.basename(file, path.extname(file));
  }

  const sections: { type: 'strofa' | 'refren'; text: string }[] = [];

  for (let i = 1; i < slideFiles.length; i++) {
    const shapes = await parseShapes(zip, slideFiles[i]);
    const contentShapes = shapes
      .filter(s => !isFooter(s))
      .sort((a, b) => a.yOffset - b.yOffset);

    if (contentShapes.length === 0) continue;

    const allLines: string[] = [];
    for (const shape of contentShapes) {
      for (const paragraph of shape.paragraphs) {
        const line = normalize(paragraph);
        if (line.length > 0) allLines.push(line);
      }
    }

    if (allLines.length === 0) continue;
    sections.push(...processLines(allLines));
  }

  return buildImportData(info, dedupeSections(sections), categoryId);
}

export async function importPresentationFiles(
  filePaths: string[],
  categoryId?: number
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  const batch: HymnImportData[] = [];
  const presentationFiles = getPowerPointFiles(filePaths);

  if (presentationFiles.length === 0) {
    return {
      success: 0,
      failed: 0,
      errors: ['Nu au fost găsite fișiere PowerPoint compatibile. Folosește .ppt sau .pptx.'],
    };
  }

  try {
    for (const filePath of presentationFiles) {
      const file = path.basename(filePath);

      try {
        const ext = path.extname(filePath).toLowerCase();
        const hymn = ext === '.ppt'
          ? await extractLegacyPptImportData(filePath, filePath, categoryId)
          : await extractPptxImportData(filePath, filePath, categoryId);
        batch.push(hymn);
        success++;
      } catch (err: unknown) {
        console.error(`Error processing ${file}:`, err);
        failed++;
        errors.push(`${file}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    if (batch.length > 0) {
      bulkInsertHymns(batch);
    }
  } catch (err: any) {
    console.error('Error importing PowerPoint files:', err);
    throw err;
  }

  return { success, failed, errors };
}

export async function importPresentationDirectory(
  dirPath: string,
  categoryId?: number
): Promise<{ success: number; failed: number; errors: string[] }> {
  try {
    const files = await fs.readdir(dirPath);
    const filePaths = files
      .filter(file => isPowerPointFile(file))
      .map(f => path.join(dirPath, f));
    return await importPresentationFiles(filePaths, categoryId);
  } catch (err: any) {
    console.error('Error reading directory:', err);
    throw err;
  }
}
