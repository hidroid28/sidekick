import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { SKILL_NAME_PATTERN } from '@sidekick/shared';
import type { LibraryItem } from '@sidekick/shared';
import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';

const RuleMeta = z.object({ title: z.string().min(1), priority: z.number().default(100) });
const SkillMeta = z.object({
  name: z.string().regex(SKILL_NAME_PATTERN),
  description: z.string().min(1).max(300),
  allowed_tools: z.array(z.string()).default([]),
});

export interface Rule { name: string; title: string; priority: number; body: string; }
export interface Skill { name: string; description: string; allowedTools: string[]; body: string; }

/** Roughly four characters per token. */
export const RULES_CHAR_BUDGET = 8000;

/** Splits YAML frontmatter from Markdown. Only YAML is parsed; nothing is executed. */
export function parseFrontmatter(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source.replace(/^﻿/, ''));
  if (!match) throw new Error('The file must start with a --- frontmatter block');
  return { meta: parseYaml(match[1]!) as unknown, body: match[2]!.trim() };
}

export function parseRule(name: string, source: string): Rule {
  const { meta, body } = parseFrontmatter(source);
  return { name, ...RuleMeta.parse(meta), body };
}

export function parseSkill(source: string): Skill {
  const { meta, body } = parseFrontmatter(source);
  const { name, description, allowed_tools } = SkillMeta.parse(meta);
  return { name, description, allowedTools: allowed_tools, body };
}

/** Keeps rules in priority order until the budget runs out. Lowest priority goes first. */
export function fitRules(rules: Rule[], budget = RULES_CHAR_BUDGET) {
  const kept: Rule[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))) {
    if (used + rule.body.length > budget) dropped.push(rule.name);
    else {
      used += rule.body.length;
      kept.push(rule);
    }
  }
  return { kept, dropped };
}

/** Files are read on each request so edits apply at once, with no restart. */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);
  private readonly root: string;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.root = resolve(config.libraryDir);
  }

  async rules(): Promise<Rule[]> {
    const dir = join(this.root, 'rules');
    const rules: Rule[] = [];
    for (const file of await this.list(dir)) {
      if (!file.endsWith('.md')) continue;
      try {
        rules.push(parseRule(file.slice(0, -3), await readFile(join(dir, file), 'utf8')));
      } catch (error) {
        this.logger.warn(`Skipping rule ${file}: ${String(error)}`);
      }
    }
    const { kept, dropped } = fitRules(rules);
    if (dropped.length) this.logger.warn(`Rules over budget, dropped: ${dropped.join(', ')}`);
    return kept;
  }

  async skills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    for (const name of await this.list(join(this.root, 'skills'))) {
      if (!SKILL_NAME_PATTERN.test(name)) continue;
      try {
        const skill = parseSkill(await readFile(this.skillPath(name), 'utf8'));
        if (skill.name === name) skills.push(skill);
        else this.logger.warn(`Skipping skill ${name}: its name field says ${skill.name}`);
      } catch (error) {
        this.logger.warn(`Skipping skill ${name}: ${String(error)}`);
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async skill(name: string): Promise<Skill | undefined> {
    return (await this.skills()).find((s) => s.name === name);
  }

  /** Reads a file inside one skill's folder. Paths that escape the folder are refused. */
  async readSkillFile(skillName: string, path: string) {
    if (!SKILL_NAME_PATTERN.test(skillName)) throw new Error('Unknown skill');
    const base = join(this.root, 'skills', skillName);
    const target = resolve(base, path);
    const inside = relative(base, target);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || resolve(inside) === inside) {
      throw new Error('That file is outside this skill');
    }
    return readFile(target, 'utf8');
  }

  async items(): Promise<LibraryItem[]> {
    const rules = (await this.rules()).map((r): LibraryItem => ({
      kind: 'rules', name: r.name, title: r.title, description: '',
    }));
    const skills = (await this.skills()).map((s): LibraryItem => ({
      kind: 'skills', name: s.name, title: s.name, description: s.description,
    }));
    return [...rules, ...skills];
  }

  async readSource(kind: string, name: string) {
    try {
      return await readFile(this.sourcePath(kind, name), 'utf8');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new NotFoundException('File not found');
    }
  }

  async saveSource(kind: string, name: string, content: string) {
    const path = this.sourcePath(kind, name);
    try {
      if (kind === 'rules') parseRule(name, content);
      else if (parseSkill(content).name !== name) throw new Error('The name field must match the skill');
    } catch (error) {
      const message = error instanceof z.ZodError ? z.prettifyError(error) : (error as Error).message;
      throw new BadRequestException(message);
    }
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
  }

  private sourcePath(kind: string, name: string) {
    if (!SKILL_NAME_PATTERN.test(name)) throw new BadRequestException('Use lowercase letters, numbers, and dashes');
    if (kind === 'rules') return join(this.root, 'rules', `${name}.md`);
    if (kind === 'skills') return this.skillPath(name);
    throw new BadRequestException('Unknown library section');
  }

  private skillPath(name: string) {
    return join(this.root, 'skills', name, 'SKILL.md');
  }

  private async list(dir: string) {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }
}
