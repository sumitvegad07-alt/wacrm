import { GoogleGenerativeAI } from '@google/generative-ai';

function getGenAI(apiKey: string) {
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Generates a 768-dimensional embedding vector for the given text.
 */
export async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const model = getGenAI(apiKey).getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text }] },
    // @ts-ignore - Some SDK versions don't have this in their type definitions
    outputDimensionality: 768
  });
  
  return result.embedding.values;
}

/**
 * Splits a large body of text into smaller chunks for vector storage.
 * A very simple implementation splitting by paragraphs for phase 1.
 */
export function chunkText(text: string, maxChunkLength = 1000): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  
  let currentChunk = '';
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * Generates an answer using the provided context chunks.
 */
export async function generateRagResponse(
  userQuery: string,
  contextChunks: string[],
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const model = getGenAI(apiKey).getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: systemPrompt,
  });

  const contextStr = contextChunks.map((c, i) => `[Context ${i + 1}]:\n${c}`).join('\n\n');
  
  const prompt = `Here is the knowledge base context:\n\n${contextStr}\n\nUser Question:\n${userQuery}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1, // Keep it grounded to the context
    }
  });

  return result.response.text();
}
