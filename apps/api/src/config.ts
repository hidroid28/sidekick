import { join } from 'node:path';

export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  apiKey?: string;
  model?: string;
  useSystemInstruction: boolean;
  apiBase: string;
  databasePath: string;
  libraryDir: string;
  passcode?: string;
  webOrigin: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    apiKey: env.GOOGLE_API_KEY || undefined,
    model: env.GEMMA_MODEL || undefined,
    useSystemInstruction: env.GEMMA_USE_SYSTEM_INSTRUCTION === 'true',
    apiBase: env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta',
    databasePath: env.DATABASE_PATH || join('data', 'sidekick.sqlite'),
    libraryDir: env.LIBRARY_DIR || 'library',
    passcode: env.DEMO_PASSCODE || undefined,
    webOrigin: env.WEB_ORIGIN || 'http://localhost:3000',
    port: Number(env.PORT) || 3001,
  };
}
