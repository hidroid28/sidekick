import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MAX_UPLOAD_BYTES } from '@sidekick/shared';
import { chunkText, rankChunks, tokenize } from '../src/knowledge/knowledge.service.js';
import { FakeModel, makeServices } from './helpers.js';

const chunk = (document: string, part: number, text: string) => ({ document, part, text });
const base64 = (text: string) => Buffer.from(text).toString('base64');
const knowledgeService = () => makeServices(new FakeModel([])).knowledge;

describe('tokenize', () => {
  it('lowercases, drops stop words, and keeps non-English letters', () => {
    expect(tokenize('The Deposit is K500, mwaiseni!')).toEqual(['deposit', 'k500', 'mwaiseni']);
  });
});

describe('chunkText', () => {
  it('keeps short paragraphs together', () => {
    expect(chunkText('One.\n\nTwo.', 100)).toEqual(['One.\n\nTwo.']);
  });

  it('splits at paragraph boundaries when over size', () => {
    expect(chunkText(`${'a'.repeat(60)}\n\n${'b'.repeat(60)}`, 100)).toHaveLength(2);
  });

  it('cuts long paragraphs with an overlap and loses nothing', () => {
    const text = Array.from({ length: 300 }, (_, i) => String(i % 10)).join('');
    const chunks = chunkText(text, 100, 20);
    expect(chunks[0]!.slice(-20)).toBe(chunks[1]!.slice(0, 20));
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.at(-1)!.endsWith(text.slice(-10))).toBe(true);
  });

  it('returns nothing for blank text', () => {
    expect(chunkText('  \n\n  ')).toEqual([]);
  });
});

describe('rankChunks', () => {
  const chunks = [
    chunk('a', 1, 'The late delivery penalty is 2% per week.'),
    chunk('a', 2, 'A deposit of 40% is due. The deposit is not refunded.'),
    chunk('b', 1, 'Unrelated notes about cloth.'),
  ];

  it('ranks the most relevant chunk first', () => {
    expect(rankChunks(chunks, 'When is the deposit refunded?')[0]).toMatchObject({ document: 'a', part: 2 });
  });

  it('returns nothing with no matches or only stop words', () => {
    expect(rankChunks(chunks, 'giraffe')).toEqual([]);
    expect(rankChunks(chunks, 'what is the')).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => chunk('a', i, 'deposit'));
    expect(rankChunks(many, 'deposit', 3)).toHaveLength(3);
  });
});

describe('KnowledgeService', () => {
  it('uploads text and finds it with a citation', async () => {
    const service = knowledgeService();
    await service.upload({ name: 'c.txt', mimeType: 'text/plain', data: base64('The deposit is 40%.') });
    expect(service.search('deposit')).toMatchObject({ citations: [{ document: 'c.txt', part: 1 }] });
  });

  it('says when nothing matches', () => {
    expect(knowledgeService().search('anything')).toEqual({
      text: 'No matching text was found in the uploaded documents.',
      citations: [],
    });
  });

  it('rejects files over the limit', async () => {
    const data = Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString('base64');
    await expect(knowledgeService().upload({ name: 'big.txt', mimeType: 'text/plain', data })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty files', async () => {
    await expect(knowledgeService().upload({ name: 'blank.txt', mimeType: 'text/plain', data: base64('   ') })).rejects.toThrow(/No readable text/);
  });

  it('extracts text from a real PDF', async () => {
    const stream = 'BT /F1 12 Tf 72 720 Td (The deposit is forty percent) Tj ET';
    const pdf = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      'trailer << /Root 1 0 R /Size 6 >>',
      '%%EOF',
    ].join('\n');
    const service = knowledgeService();
    await service.upload({ name: 'real.pdf', mimeType: 'application/pdf', data: base64(pdf) });
    expect(service.search('deposit').text).toContain('forty percent');
  });

  it('rejects a corrupt PDF cleanly', async () => {
    await expect(knowledgeService().upload({ name: 'bad.pdf', mimeType: 'application/pdf', data: base64('not a pdf') })).rejects.toThrow(/could not be read/);
  });
});
