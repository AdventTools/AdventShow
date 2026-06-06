import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { parseLegacyPptTextSlides } from './import';

// ═════════════════════════════════════════════════════════════════════════════
// Prezentări editabile — modelul intern AdventShow
//
// Un PPT/PPTX local se CONVERTEȘTE în acest model (nu se randează PowerPoint):
// fiecare slide = forme de text poziționate procentual, cu HTML restrâns
// (paragrafe, buleturi, numerotare, bold/italic, aliniere). Modelul e apoi
// editabil live din aplicație și randat identic pe proiecție.
//
// Fidelitate asumată: textul + structura (liste, aliniere, poziții). Se pierd
// intenționat: temele PowerPoint, animațiile, formele decorative, imaginile.
// ═════════════════════════════════════════════════════════════════════════════

export interface PresShape {
  x: number;      // procente din lățimea slide-ului (0–100)
  y: number;
  w: number;
  h: number;
  html: string;   // subset restrâns: p/ul/ol/li/b/i/u/br + text-align
}

export interface PresSlide {
  bgColor?: string;       // fundal solid al slide-ului (opțional; altfel fundalul app)
  shapes: PresShape[];
}

export interface Presentation {
  name: string;
  slides: PresSlide[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DEFAULT_SLIDE_W = 12192000; // EMU, 16:9
const DEFAULT_SLIDE_H = 6858000;

interface ParaModel {
  html: string;                       // conținutul inline (runs deja escapate)
  bullet: 'none' | 'char' | 'num';
  level: number;
  align?: string;                     // 'center' | 'right' | 'justify'
}

/** Grupează paragrafe consecutive cu același tip de listă în <ul>/<ol>. */
function paragraphsToHtml(paras: ParaModel[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < paras.length) {
    const p = paras[i];
    if (p.bullet === 'none') {
      const style = p.align ? ` style="text-align:${p.align}"` : '';
      out.push(`<p${style}>${p.html || '<br>'}</p>`);
      i++;
      continue;
    }
    const tag = p.bullet === 'num' ? 'ol' : 'ul';
    const items: string[] = [];
    while (i < paras.length && paras[i].bullet === p.bullet) {
      const lvlStyle = paras[i].level > 0 ? ` style="margin-left:${paras[i].level * 1.4}em"` : '';
      items.push(`<li${lvlStyle}>${paras[i].html || '<br>'}</li>`);
      i++;
    }
    out.push(`<${tag}>${items.join('')}</${tag}>`);
  }
  return out.join('');
}

// ── PPTX (structural) ────────────────────────────────────────────────────────

// structura xml2js e dinamică
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

function parseRun(run: XmlNode): string {
  let t = '';
  const tEl = run['a:t'];
  if (Array.isArray(tEl)) t = tEl.map((x: unknown) => (typeof x === 'string' ? x : (x as { _?: string })?._ ?? '')).join('');
  else if (typeof tEl === 'string') t = tEl;
  let html = escapeHtml(t);
  const rPr = run['a:rPr']?.[0]?.['$'] ?? {};
  if (rPr.b === '1') html = `<b>${html}</b>`;
  if (rPr.i === '1') html = `<i>${html}</i>`;
  if (rPr.u && rPr.u !== 'none') html = `<u>${html}</u>`;
  return html;
}

function parseParagraph(para: XmlNode, isBodyPlaceholder: boolean): ParaModel {
  const pPr = para['a:pPr']?.[0];
  const attrs = pPr?.['$'] ?? {};
  const level = parseInt(attrs.lvl ?? '0') || 0;
  const algnMap: Record<string, string> = { ctr: 'center', r: 'right', just: 'justify' };
  const align = algnMap[attrs.algn ?? ''] || undefined;

  // Buleturi: explicit din slide; dacă lipsesc, placeholder-ele de corp moștenesc
  // buleturi din master (aproximare — nu citim masterul).
  let bullet: ParaModel['bullet'];
  if (pPr?.['a:buNone']) bullet = 'none';
  else if (pPr?.['a:buAutoNum']) bullet = 'num';
  else if (pPr?.['a:buChar']) bullet = 'char';
  else bullet = isBodyPlaceholder ? 'char' : 'none';

  const runs: XmlNode[] = para['a:r'] ?? [];
  const html = runs.map(parseRun).join('');
  // paragraf complet gol → fără bulet (PowerPoint nu desenează bulet pe gol)
  if (!html.trim()) bullet = 'none';
  return { html, bullet, level, align };
}

async function parsePptx(filePath: string): Promise<Presentation> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));

  // dimensiunea slide-ului (pentru coordonate procentuale)
  let slideW = DEFAULT_SLIDE_W;
  let slideH = DEFAULT_SLIDE_H;
  try {
    const presXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (presXml) {
      const pres = await parseStringPromise(presXml, { explicitArray: true });
      const sz = pres?.['p:presentation']?.['p:sldSz']?.[0]?.['$'];
      if (sz?.cx) slideW = parseInt(sz.cx);
      if (sz?.cy) slideH = parseInt(sz.cy);
    }
  } catch { /* dimensiuni implicite */ }

  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.match(/slide(\d+)/)![1]) - parseInt(b.match(/slide(\d+)/)![1]));
  if (slideFiles.length === 0) throw new Error('Nu am găsit slide-uri în prezentare.');

  const slides: PresSlide[] = [];
  for (const file of slideFiles) {
    const xml = await zip.file(file)!.async('string');
    const doc = await parseStringPromise(xml, { explicitArray: true });
    const cSld = doc?.['p:sld']?.['p:cSld']?.[0];
    const spTree = cSld?.['p:spTree']?.[0];
    const slide: PresSlide = { shapes: [] };

    // fundal solid (dacă există)
    const bgColor = cSld?.['p:bg']?.[0]?.['p:bgPr']?.[0]?.['a:solidFill']?.[0]?.['a:srgbClr']?.[0]?.['$']?.val;
    if (bgColor) slide.bgColor = `#${bgColor}`;

    let noCoordIndex = 0;
    for (const sp of spTree?.['p:sp'] ?? []) {
      const txBody = sp?.['p:txBody']?.[0];
      if (!txBody) continue;

      const phType = sp?.['p:nvSpPr']?.[0]?.['p:nvPr']?.[0]?.['p:ph']?.[0]?.['$']?.type ?? '';
      const isTitle = phType === 'title' || phType === 'ctrTitle';
      const isBodyPlaceholder = !isTitle && sp?.['p:nvSpPr']?.[0]?.['p:nvPr']?.[0]?.['p:ph'] != null;

      const paras = (txBody['a:p'] ?? []).map((p: XmlNode) => parseParagraph(p, isBodyPlaceholder));
      const html = paragraphsToHtml(paras);
      if (!html.replace(/<br>|<\/?(p|ul|ol|li)[^>]*>/g, '').trim()) continue;

      // coordonate; placeholder-ele fără xfrm moștenesc din layout — aproximăm benzi
      const xfrm = sp?.['p:spPr']?.[0]?.['a:xfrm']?.[0];
      const off = xfrm?.['a:off']?.[0]?.['$'];
      const ext = xfrm?.['a:ext']?.[0]?.['$'];
      let x: number, y: number, w: number, h: number;
      if (off && ext) {
        x = (parseInt(off.x) / slideW) * 100;
        y = (parseInt(off.y) / slideH) * 100;
        w = (parseInt(ext.cx) / slideW) * 100;
        h = (parseInt(ext.cy) / slideH) * 100;
      } else if (isTitle) {
        x = 6; y = 5; w = 88; h = 18;
      } else {
        x = 6; y = 26 + noCoordIndex * 34; w = 88; h = 32;
        noCoordIndex++;
      }
      slide.shapes.push({
        x: Math.max(0, Math.min(98, x)),
        y: Math.max(0, Math.min(98, y)),
        w: Math.max(2, Math.min(100, w)),
        h: Math.max(2, Math.min(100, h)),
        html,
      });
    }
    slides.push(slide);
  }

  return { name: path.basename(filePath, path.extname(filePath)), slides };
}

// ── PPT legacy (doar text, stivuit) ──────────────────────────────────────────

async function parseLegacyPpt(filePath: string): Promise<Presentation> {
  const slidesRaw = await parseLegacyPptTextSlides(filePath);
  const slides: PresSlide[] = slidesRaw.map(blocks => {
    const slide: PresSlide = { shapes: [] };
    // primul bloc de tip titlu (0/6) devine titlu sus; restul se stivuiesc
    const titleIdx = blocks.findIndex(b => b.textType === 0 || b.textType === 6);
    let y = 26;
    blocks.forEach((b, i) => {
      const lines = b.text.split('\n').map(l => `<p>${escapeHtml(l)}</p>`).join('');
      if (!lines) return;
      if (i === titleIdx) {
        slide.shapes.push({ x: 4, y: 5, w: 92, h: 18, html: `<p style="text-align:center"><b>${escapeHtml(b.text.replace(/\n/g, ' '))}</b></p>` });
      } else {
        const h = Math.min(60, 8 + b.text.split('\n').length * 7);
        slide.shapes.push({ x: 6, y, w: 88, h, html: lines });
        y = Math.min(90, y + h + 2);
      }
    });
    return slide;
  }).filter(s => s.shapes.length > 0);

  if (slides.length === 0) throw new Error('Nu am găsit text în prezentare.');
  return { name: path.basename(filePath, path.extname(filePath)), slides };
}

// ── API ──────────────────────────────────────────────────────────────────────

export async function parsePresentationFile(filePath: string): Promise<Presentation> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pptx') return parsePptx(filePath);
  if (ext === '.ppt') return parseLegacyPpt(filePath);
  throw new Error('Format nesuportat — folosește .ppt sau .pptx.');
}

// ═════════════════════════════════════════════════════════════════════════════
// Șabloane (template-uri): JSON-uri cu modelul Presentation.
//  • cele STANDARD vin cu aplicația (extraResources/templates) și se copiază la
//    pornire în userData/templates DOAR dacă lipsesc (nu suprascriu nimic);
//  • cele CUSTOM ale bisericii stau tot în userData/templates → upgrade-urile
//    nu le ating niciodată (installerul nu umblă în userData).
// ═════════════════════════════════════════════════════════════════════════════

export interface TemplateInfo { file: string; name: string }

export function seedTemplatesIfNeeded(resourceTemplatesDir: string, userTemplatesDir: string) {
  try {
    if (!fsSync.existsSync(userTemplatesDir)) fsSync.mkdirSync(userTemplatesDir, { recursive: true });
    if (!fsSync.existsSync(resourceTemplatesDir)) return;
    for (const f of fsSync.readdirSync(resourceTemplatesDir)) {
      if (!f.endsWith('.json')) continue;
      const dest = path.join(userTemplatesDir, f);
      if (!fsSync.existsSync(dest)) {
        fsSync.copyFileSync(path.join(resourceTemplatesDir, f), dest);
      }
    }
  } catch (err) {
    console.error('[Templates] seed failed:', err);
  }
}

export async function listTemplates(userTemplatesDir: string): Promise<TemplateInfo[]> {
  try {
    const files = await fs.readdir(userTemplatesDir);
    const out: TemplateInfo[] = [];
    for (const f of files.filter(f => f.endsWith('.json')).sort()) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(userTemplatesDir, f), 'utf8'));
        out.push({ file: f, name: data?.name || f.replace(/\.json$/, '') });
      } catch { /* fișier corupt — îl sărim */ }
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadTemplate(userTemplatesDir: string, file: string): Promise<Presentation> {
  // doar nume simplu de fișier — fără traversare de directoare
  if (!/^[^/\\]+\.json$/.test(file)) throw new Error('Nume de șablon invalid.');
  const raw = JSON.parse(await fs.readFile(path.join(userTemplatesDir, file), 'utf8'));
  if (!Array.isArray(raw?.slides)) throw new Error('Șablon corupt.');
  return raw as Presentation;
}

export async function saveTemplate(userTemplatesDir: string, name: string, data: Presentation): Promise<TemplateInfo> {
  const safe = name.trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'Șablon';
  const file = `${safe}.json`;
  await fs.mkdir(userTemplatesDir, { recursive: true });
  await fs.writeFile(path.join(userTemplatesDir, file), JSON.stringify({ ...data, name: safe }, null, 1), 'utf8');
  return { file, name: safe };
}

export async function deleteTemplate(userTemplatesDir: string, file: string): Promise<void> {
  if (!/^[^/\\]+\.json$/.test(file)) throw new Error('Nume de șablon invalid.');
  await fs.unlink(path.join(userTemplatesDir, file));
}
