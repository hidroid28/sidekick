import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';
import { MAX_UPLOAD_BYTES } from '@sidekick/shared';
import type { Citation, Upload } from '@sidekick/shared';
import { DatabaseService } from '../db/database.service.js';
import type { ChunkRow } from '../db/database.service.js';

const CHUNK_CHARS = 900;
const OVERLAP_CHARS = 120;
const FALLBACK_CHUNKS = 4;
const STOP_WORDS = new Set(
  'a an and are as at be by do does for from has have how i in is it its me my of on or our so that the their them they this to was we what when where which who why will with you your'.split(' '),
);

export function tokenize(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOP_WORDS.has(w));
}

/** Splits text on paragraphs, then cuts long paragraphs with a small overlap. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = OVERLAP_CHARS) {
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const paragraph of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    if (current.length + paragraph.length + 2 > size) flush();
    if (paragraph.length <= size) {
      current += `${current ? '\n\n' : ''}${paragraph}`;
      continue;
    }
    for (let start = 0; start < paragraph.length; start += size - overlap) {
      chunks.push(paragraph.slice(start, start + size).trim());
      if (start + size >= paragraph.length) break;
    }
  }
  flush();
  return chunks;
}

/** BM25 ranking over the given chunks. */
export function rankChunks(chunks: ChunkRow[], query: string, limit = 4) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !chunks.length) return [];
  // File names count, so "contract" finds contract.txt even if the text says "agreement".
  const docs = chunks.map((chunk) => ({ chunk, words: tokenize(`${chunk.document} ${chunk.text}`) }));
  const averageLength = docs.reduce((sum, d) => sum + d.words.length, 0) / docs.length || 1;
  const k1 = 1.5;
  const b = 0.75;
  const idf = new Map(
    terms.map((term) => {
      const n = docs.filter((d) => d.words.includes(term)).length;
      return [term, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))];
    }),
  );
  return docs
    .map(({ chunk, words }) => {
      const score = terms.reduce((sum, term) => {
        const tf = words.filter((w) => w === term).length;
        if (!tf) return sum;
        return sum + (idf.get(term)! * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * words.length) / averageLength));
      }, 0);
      return { chunk, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.chunk);
}

@Injectable()
export class KnowledgeService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async upload(file: Upload) {
    const bytes = Buffer.from(file.data, 'base64');
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Files can be up to 5 MB');
    const text = await this.extract(file.mimeType, bytes);
    const chunks = chunkText(text);
    if (!chunks.length) {
      throw new BadRequestException('No readable text found. Scanned PDFs are not supported yet.');
    }
    return { id: this.db.addDocument(file.name, chunks), parts: chunks.length };
  }

  search(query: string): { text: string; citations: Citation[] } {
    const chunks = this.db.allChunks();
    if (!chunks.length) return { text: 'No documents have been uploaded.', citations: [] };
    const matches = rankChunks(chunks, query);
    if (matches.length) return this.format(matches);

    // Keyword search misses synonyms, so show the opening text rather than reporting nothing.
    const opening = chunks.filter((c) => c.part <= 2).slice(0, FALLBACK_CHUNKS);
    const result = this.format(opening);
    return { ...result, text: `No exact word match. These are the opening parts of the documents:\n\n${result.text}` };
  }

  private format(chunks: ChunkRow[]) {
    return {
      text: chunks.map((c) => `[${c.document}, part ${c.part}]\n${c.text}`).join('\n\n'),
      citations: chunks.map((c) => ({ document: c.document, part: c.part })),
    };
  }

  private async extract(mimeType: string, bytes: Buffer) {
    if (mimeType !== 'application/pdf') return bytes.toString('utf8');
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      return (await extractText(pdf, { mergePages: true })).text;
    } catch {
      throw new BadRequestException('That PDF could not be read');
    }
  }
}
