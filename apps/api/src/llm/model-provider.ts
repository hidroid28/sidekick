import type { ImageInput } from '@sidekick/shared';

export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
  image?: ImageInput;
}

export interface ModelProvider {
  /** Streams visible reply text. Must never yield model reasoning. */
  stream(messages: ModelMessage[], options: { signal?: AbortSignal }): AsyncIterable<string>;
}

/** An error whose message is safe to show to the user. */
export class ModelError extends Error {}
