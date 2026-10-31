import { describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { fitRules, LibraryService, parseFrontmatter, parseRule, parseSkill } from '../src/library/library.service.js';
import { NOTE_SKILL, testConfig } from './helpers.js';

const library = () => new LibraryService(testConfig());

describe('frontmatter', () => {
  it('splits YAML from the body, with CRLF and a BOM', () => {
    expect(parseFrontmatter('\uFEFF---\r\ntitle: A\r\n---\r\nBody')).toEqual({ meta: { title: 'A' }, body: 'Body' });
  });

  it('rejects a file with no frontmatter', () => {
    expect(() => parseFrontmatter('# Just text')).toThrow(/frontmatter/);
  });

  it('never executes a code frontmatter block', () => {
    expect(() => parseFrontmatter('---js\nthrow new Error("ran")\n---\nBody')).toThrow(/frontmatter/);
  });

  it('defaults a rule priority and skill tools', () => {
    expect(parseRule('a', '---\ntitle: A\n---\nB').priority).toBe(100);
    expect(parseSkill('---\nname: a\ndescription: d\n---\nB').allowedTools).toEqual([]);
  });

  it('rejects unsafe skill names', () => {
    expect(() => parseSkill('---\nname: ../evil\ndescription: d\n---\nB')).toThrow();
  });
});

describe('fitRules', () => {
  const rule = (name: string, priority: number, size: number) => ({ name, title: name, priority, body: 'x'.repeat(size) });

  it('orders by priority and drops the least important rule first', () => {
    const { kept, dropped } = fitRules([rule('tone', 20, 60), rule('safety', 0, 60)], 100);
    expect(kept.map((r) => r.name)).toEqual(['safety']);
    expect(dropped).toEqual(['tone']);
  });
});

describe('LibraryService', () => {
  it('loads rules in priority order', async () => {
    expect((await library().rules()).map((r) => r.name)).toEqual(['00-safety', '20-tone']);
  });

  it('applies an edited skill on the next read, with no restart', async () => {
    const service = library();
    await service.saveSource('skills', 'note', NOTE_SKILL.replace('Note steps.', 'New steps.'));
    expect((await service.skill('note'))?.body).toBe('New steps.');
  });

  it('reads files inside the skill folder', async () => {
    await expect(library().readSkillFile('draft-quote', 'templates/quote.md')).resolves.toBe('Template body');
  });

  it.each(['../../secret.txt', '..', '.', '', '../note/SKILL.md', 'C:\\Windows\\win.ini', '/etc/passwd'])(
    'refuses the path %s',
    async (path) => {
      await expect(library().readSkillFile('draft-quote', path)).rejects.toThrow();
    },
  );

  it('refuses invalid content without saving it', async () => {
    const service = library();
    await expect(service.saveSource('skills', 'note', 'no frontmatter')).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.skill('note'))?.body).toBe('Note steps.');
  });

  it('refuses a skill whose name field does not match its folder', async () => {
    await expect(library().saveSource('skills', 'other', NOTE_SKILL)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['../secret', 'a/b', 'A B'])('refuses the source name %s', async (name) => {
    await expect(library().readSource('rules', name)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unknown section and reports a missing file', async () => {
    await expect(library().readSource('secrets', 'a')).rejects.toBeInstanceOf(BadRequestException);
    await expect(library().readSource('rules', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
