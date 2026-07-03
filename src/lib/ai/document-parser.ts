import * as cheerio from 'cheerio';
import { YoutubeTranscript } from 'youtube-transcript';
import mammoth from 'mammoth';
const pdf = require('pdf-parse');

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

  // Extract text, keeping some structure
  let text = '';
  $('h1, h2, h3, h4, h5, h6, p, li').each((_, el) => {
    const elText = $(el).text().trim();
    if (elText) {
      text += elText + '\n\n';
    }
  });

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
    const data = await pdf(buffer);
    return data.text;
  } 
  else if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
    file.name.endsWith('.docx')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  else if (file.type.startsWith('text/')) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(arrayBuffer);
  }

  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}
