import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';

const REQUEST_TIMEOUT_MS = 20_000;

const WalletSchema = z.object({ id: z.string().min(1), chain: z.string().min(1) });
export type Wallet = z.infer<typeof WalletSchema>;

const text = z.union([z.string(), z.number()]).transform(String);
const DepositSchema = z.object({
  id: z.string().min(1),
  developer_fee: text.nullish(),
  source_deposit_instructions: z.object({
    payment_rail: z.string().min(1),
    currency: z.string().min(1),
    to_address: z.string().min(1),
    amount: text,
  }),
});
export type Deposit = z.infer<typeof DepositSchema>;

/** The message is always safe to show the user. Details stay in the server log. */
export class DevdraftError extends HttpException {}

/** Marks a simulated deposit. Links store this id, so they stay labelled after the setting changes. */
export const SIMULATED_PREFIX = 'simulated:';
/** Deliberately not valid hex, so no wallet can send funds to it. */
export const SIMULATED_ADDRESS = '0xSIMULATED-DEMO-ADDRESS-DO-NOT-SEND-FUNDS';

export const NO_WALLET_MESSAGE = 'Payments unlock after identity verification.';

function errorFor(status: number, path: string) {
  switch (status) {
    case 400:
      return new DevdraftError('Check the payment details and try again.', HttpStatus.BAD_REQUEST);
    case 401:
      return new DevdraftError('Payments are unavailable.', HttpStatus.SERVICE_UNAVAILABLE);
    case 403:
      return new DevdraftError("This account can't receive payments yet.", HttpStatus.FORBIDDEN);
    case 404:
      return path === '/wallets/default'
        ? new DevdraftError(NO_WALLET_MESSAGE, HttpStatus.NOT_FOUND)
        : new DevdraftError('The payment wallet changed. Please try again.', HttpStatus.NOT_FOUND);
    default:
      return new DevdraftError('Something went wrong. Try again.', HttpStatus.BAD_GATEWAY);
  }
}

/** Devdraft keys stay here, on the server. They never reach the browser. */
@Injectable()
export class DevdraftClient {
  private readonly logger = new Logger(DevdraftClient.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get simulated() {
    return this.config.devdraftSimulate;
  }

  get configured() {
    return this.simulated || Boolean(this.config.devdraftKey && this.config.devdraftSecret);
  }

  async defaultWallet(): Promise<Wallet> {
    if (this.simulated) return { id: 'simulated-wallet', chain: 'base' };
    return WalletSchema.parse(await this.request('/wallets/default'));
  }

  /** Each call creates a new pending deposit, so call it once per link. */
  async createDeposit(wallet: Wallet, amount: number): Promise<Deposit> {
    if (this.simulated) {
      return {
        id: `${SIMULATED_PREFIX}${randomUUID()}`,
        developer_fee: '0',
        source_deposit_instructions: {
          payment_rail: wallet.chain,
          currency: 'usdc',
          to_address: SIMULATED_ADDRESS,
          amount: String(amount),
        },
      };
    }
    const body = { walletId: wallet.id, network: wallet.chain, stableCoinCurrency: 'usdc', amount };
    return DepositSchema.parse(
      await this.request('/transfers/direct-wallet', { method: 'POST', body: JSON.stringify(body) }),
    );
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.configured) throw new DevdraftError('Payments are not set up yet.', HttpStatus.SERVICE_UNAVAILABLE);
    let response: Response;
    try {
      response = await fetch(`${this.config.devdraftBase}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-client-key': this.config.devdraftKey!,
          'x-client-secret': this.config.devdraftSecret!,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Devdraft ${path} unreachable: ${String(error)}`);
      throw new DevdraftError('Something went wrong. Try again.', HttpStatus.BAD_GATEWAY);
    }
    if (!response.ok) {
      this.logger.warn(`Devdraft ${path} ${response.status}: ${(await response.text()).slice(0, 300)}`);
      throw errorFor(response.status, path);
    }
    return response.json();
  }
}
