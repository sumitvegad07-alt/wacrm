import * as cheerio from 'cheerio';
import { YoutubeTranscript } from 'youtube-transcript';



/**
 * Extracts text from a generic URL using Cheerio
 */
export async function extractTextFromURL(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.statusText}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove unnecessary tags
  $('script, style, noscript, iframe, img, svg, nav, footer, header').remove();

  let text = $('body').text();
  
  // Clean up excessive whitespace
  text = text.replace(/\\s+/g, ' ');

  return text.trim();
}

/**
 * Extracts text from a YouTube Video URL
 */
export async function extractTextFromYouTube(url: string): Promise<string> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(url);
    const text = transcript.map(t => t.text).join(' ');
    return text.trim();
  } catch (error: any) {
    throw new Error('Failed to fetch YouTube transcript: ' + error.message);
  }
}

/**
 * Extracts text from a File object (PDF, Word, or Text)
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    // Polyfill DOMMatrix and Path2D for Node.js environments (Vercel) to prevent pdf.js crash
    if (typeof globalThis.DOMMatrix === 'undefined') {
      (globalThis as any).DOMMatrix = class DOMMatrix { constructor() {} };
    }
    if (typeof globalThis.Path2D === 'undefined') {
      (globalThis as any).Path2D = class Path2D { constructor() {} };
    }
    const pdf = require('pdf-parse');
    const data = await pdf(buffer);
    return data.text;
  } 
  else if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
    file.name.endsWith('.docx')
  ) {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  else if (file.type.startsWith('text/')) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(arrayBuffer);
  }

  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}
