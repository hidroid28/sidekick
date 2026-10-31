import type { Profile } from '@sidekick/shared';
import type { Rule, Skill } from '../library/library.service.js';
import type { ToolSpec } from '../tools/tools.service.js';

/** Stops text inside the wrapper from closing it early. */
export function wrapUntrusted(source: string, text: string) {
  return `<untrusted source="${source}">\n${text.replace(/<\/?untrusted/gi, '[tag removed]')}\n</untrusted>`;
}

export interface PromptInput {
  rules: Rule[];
  skills: Skill[];
  activeSkill?: Skill;
  tools: ToolSpec[];
  profile: Profile;
  today: string;
}

export function buildSystemPrompt({ rules, skills, activeSkill, tools, profile, today }: PromptInput) {
  const facts = [
    profile.name && `Name: ${profile.name}`,
    profile.work && `What they do: ${profile.work}`,
    profile.currency && `Currency: ${profile.currency}`,
  ].filter(Boolean);
  const sections = [
    rules.map((r) => `## ${r.title}\n${r.body}`).join('\n\n'),
    `## Today\n${today}`,
    `## User profile\n${facts.length ? facts.join('\n') : 'Not provided. Do not guess.'}`,
    `## Skills\nCall use_skill when one fits. Do not guess what a skill says.\n${skills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n')}`,
    `## Tools\nTo use a tool, reply with only this block and wait for the result:\n\`\`\`tool\n{"tool": "name", "args": {}}\n\`\`\`\nAvailable tools:\n${tools
      .map((t) => `- ${t.name} ${t.args}: ${t.description}`)
      .join('\n')}`,
  ];
  if (activeSkill) sections.push(`## Active skill: ${activeSkill.name}\n${activeSkill.body}`);
  return sections.join('\n\n');
}

/** Reads `/skill-name rest of message`. Returns undefined for ordinary messages. */
export function parseSlashCommand(text: string) {
  const match = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? { skill: match[1]!, rest: (match[2] ?? '').trim() } : undefined;
}
