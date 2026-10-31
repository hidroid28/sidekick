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
  devdraftKey?: string;
  devdraftSecret?: string;
  devdraftBase: string;
  devdraftSimulate: boolean;
  resendApiKey?: string;
  resendBase: string;
  emailFrom: string;
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
    webOrigin: (env.WEB_ORIGIN || 'http://localhost:3000').replace(/\/+$/, ''),
    port: Number(env.PORT) || 3001,
    devdraftKey: env.DEVDRAFT_CLIENT_KEY || undefined,
    devdraftSecret: env.DEVDRAFT_CLIENT_SECRET || undefined,
    devdraftBase: env.DEVDRAFT_API_BASE || 'https://api.devdraft.ai/api/v0',
    devdraftSimulate: env.DEVDRAFT_SIMULATE === 'true',
    resendApiKey: env.RESEND_API_KEY || undefined,
    resendBase: env.RESEND_API_BASE || 'https://api.resend.com',
    // Resend's test sender only delivers to the Resend account's own address.
    emailFrom: env.EMAIL_FROM || 'Sidekick <onboarding@resend.dev>',
  };
}
