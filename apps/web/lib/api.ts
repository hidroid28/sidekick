import type {
  ConversationDetail,
  ConversationSummary,
  DocumentSummary,
  ImageInput,
  LibraryItem,
  Profile,
  RecordRow,
  RunEvent,
  Upload,
} from '@sidekick/shared';
import { SseParser } from './sse';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const PASSCODE_KEY = 'sidekick-passcode';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function savePasscode(passcode: string) {
  try {
    localStorage.setItem(PASSCODE_KEY, passcode);
  } catch {
    // Private windows can block storage. The app then asks again.
  }
}

function authHeaders(): Record<string, string> {
  try {
    const passcode = localStorage.getItem(PASSCODE_KEY);
    return passcode ? { 'x-demo-passcode': passcode } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...authHeaders() },
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the API running?', 0);
  }
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = (body as { message?: string } | undefined)?.message;
    throw new ApiError(message ?? 'Something went wrong', response.status);
  }
  return body as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  profile: () => request<Profile>('/profile'),
  saveProfile: (profile: Profile) => send<Profile>('PUT', '/profile', profile),
  conversations: () => request<ConversationSummary[]>('/conversations'),
  createConversation: () => send<ConversationSummary>('POST', '/conversations', {}),
  conversation: (id: string) => request<ConversationDetail>(`/conversations/${id}`),
  sendMessage: (id: string, text: string, image?: ImageInput) =>
    send<{ runId: string }>('POST', `/conversations/${id}/messages`, { text, image }),
  decide: (id: string, approve: boolean) => send<{ runId: string }>('POST', `/approvals/${id}/decision`, { approve }),
  stopRun: (id: string) => send<{ stopped: boolean }>('POST', `/runs/${id}/stop`, {}),
  records: () => request<RecordRow[]>('/records'),
  documents: () => request<DocumentSummary[]>('/documents'),
  uploadDocument: (file: Upload) => send<{ id: string; parts: number }>('POST', '/documents', file),
  deleteDocument: (id: string) => send<{ deleted: boolean }>('DELETE', `/documents/${id}`),
  library: () => request<LibraryItem[]>('/library'),
  librarySource: (kind: string, name: string) => request<{ content: string }>(`/library/${kind}/${name}`),
  saveLibrarySource: (kind: string, name: string, content: string) =>
    send<{ saved: boolean }>('PUT', `/library/${kind}/${name}`, { content }),
};

export async function streamRun(runId: string, onEvent: (event: RunEvent) => void) {
  const response = await fetch(`${API_URL}/runs/${runId}/events`, { headers: authHeaders() });
  if (!response.ok || !response.body) throw new ApiError('The reply could not be loaded', response.status);
  const parser = new SseParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    parser.push(value).forEach(onEvent);
  }
}

export const fileToBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });

/** Shrinks phone photos so uploads stay fast and within the API limit. */
export async function photoToInput(file: File): Promise<ImageInput> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  return { mimeType: 'image/jpeg', data };
}
