import { z } from 'zod';

export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MIME_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'text/csv'] as const;

export const ProfileSchema = z.object({
  name: z.string().trim().max(80).default(''),
  work: z.string().trim().max(200).default(''),
  currency: z.string().trim().max(8).default(''),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ImageSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  data: z.string().min(1).max(10_000_000),
});
export type ImageInput = z.infer<typeof ImageSchema>;

export const SendMessageSchema = z
  .object({ text: z.string().trim().max(8000).default(''), image: ImageSchema.optional() })
  .refine((m) => m.text.length > 0 || m.image !== undefined, 'Add a message or a photo first');
export type SendMessage = z.infer<typeof SendMessageSchema>;

export const DecisionSchema = z.object({ approve: z.boolean() });

export const UploadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: z.enum(UPLOAD_MIME_TYPES),
  data: z.string().min(1).max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8),
});
export type Upload = z.infer<typeof UploadSchema>;

export const SaveFileSchema = z.object({ content: z.string().min(1).max(20_000) });

export const QuoteArgsSchema = z.object({
  client: z.string().trim().min(1).max(120),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        quantity: z.number().positive().max(1_000_000),
        unit_price: z.number().nonnegative().max(1_000_000_000),
      }),
    )
    .min(1)
    .max(50),
  currency: z.string().trim().max(8).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type QuoteArgs = z.infer<typeof QuoteArgsSchema>;

export const ExpenseArgsSchema = z.object({
  vendor: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(1_000_000_000),
  currency: z.string().trim().max(8).optional(),
  category: z.enum(['supplies', 'transport', 'food', 'rent', 'utilities', 'marketing', 'other']).default('other'),
  date: z.string().trim().max(20).optional(),
});
export type ExpenseArgs = z.infer<typeof ExpenseArgsSchema>;

export const PaymentLinkArgsSchema = z.object({
  email: z.email('Enter a valid email address').max(200),
  amount: z
    .number()
    .positive('Enter an amount above zero')
    .max(1_000_000)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimal places'),
  description: z.string().trim().min(1, 'Add what the payment is for').max(200),
});
export type PaymentLinkArgs = z.infer<typeof PaymentLinkArgsSchema>;

export type EmailStatus = 'sent' | 'not_configured' | 'failed';

export interface PaymentWalletStatus { available: boolean; network?: string; message?: string; emailConfigured: boolean; simulated: boolean; }

export interface PaymentLink {
  token: string;
  url: string;
  recipientEmail: string;
  description: string;
  amount: string;
  currency: string;
  network: string;
  emailStatus: EmailStatus;
  simulated: boolean;
  createdAt: string;
}

/** What the payer sees. It leaves out the recipient's email address. */
export interface PublicPaymentLink {
  description: string;
  payee: string;
  toAddress: string;
  amount: string;
  currency: string;
  network: string;
  fee: string | null;
  reference: string;
  simulated: boolean;
  createdAt: string;
}

export interface Citation { document: string; part: number; }
export interface PendingApproval { id: string; tool: string; summary: string; }

export type RunEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'approval'; approval: PendingApproval }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'call' | 'tool';
  text: string;
  hasImage: boolean;
  citations: Citation[];
  createdAt: string;
}
export interface ConversationSummary { id: string; title: string; updatedAt: string; }
export interface ConversationDetail {
  id: string;
  title: string;
  activeSkill: string | null;
  messages: ChatMessage[];
  pending: PendingApproval[];
}
export interface RecordRow {
  id: string;
  kind: 'quote' | 'expense';
  title: string;
  amountCents: number;
  currency: string;
  createdAt: string;
}
export interface DocumentSummary { id: string; name: string; parts: number; createdAt: string; }
export interface LibraryItem { kind: 'rules' | 'skills'; name: string; title: string; description: string; }
