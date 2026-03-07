
import fs from 'fs';
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';

const filePaths = [
  'pptx-example/405.pptx',
  'pptx-example/416.pptx',
  'pptx-example/429.pptx',
  'pptx-example/478.pptx'
];

async function analyzePPTX() {
  for (const filePath of filePaths) {
    console.log(`\n\n========== ANALYZING ${filePath} ==========`);
    const content = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(content);
  
  // List files to verify structure
  // console.log(Object.keys(zip.files));

  // Try to find slides
  const slideFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'));
  console.log(`Found ${slideFiles.length} slides.`);

  for (const slideFile of slideFiles) {
    const slideXml = await zip.file(slideFile).async('string');
    const result = await parseStringPromise(slideXml);
    
    console.log(`\n--- ${slideFile} ---`);
    
    // deeply search for text (a:t elements)
    const textParts = [];
    
    function findText(obj) {
      if (typeof obj === 'object') {
        for (const key in obj) {
          if (key === 'a:t') {
            const val = obj[key];
             if (Array.isArray(val)) {
                textParts.push(val.join(' '));
             } else if (typeof val === 'string') {
                textParts.push(val);
             } else if (val._) {
                textParts.push(val._);
             }
          } else {
            findText(obj[key]);
          }
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(findText);
      }
    }

    findText(result);
    console.log(textParts.join('\n'));
  }
  }
}

analyzePPTX().catch(console.error);
