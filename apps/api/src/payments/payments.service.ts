import { randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EmailStatus, PaymentLink, PaymentLinkArgs, PaymentWalletStatus, PublicPaymentLink } from '@sidekick/shared';
import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';
import { DatabaseService } from '../db/database.service.js';
import type { PaymentLinkRow } from '../db/database.service.js';
import { DevdraftClient, SIMULATED_PREFIX } from './devdraft.client.js';
import { EmailService } from './email.service.js';

const isSimulated = (row: PaymentLinkRow) => row.deposit_id.startsWith(SIMULATED_PREFIX);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DevdraftClient) private readonly devdraft: DevdraftClient,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  async walletStatus(): Promise<PaymentWalletStatus> {
    const emailConfigured = this.email.configured;
    const simulated = this.devdraft.simulated;
    try {
      const wallet = await this.devdraft.defaultWallet();
      return { available: true, network: wallet.chain, emailConfigured, simulated };
    } catch (error) {
      if (error instanceof HttpException) return { available: false, message: error.message, emailConfigured, simulated };
      throw error;
    }
  }

  /** Creates one Devdraft deposit, saves the link, then tries to email it. */
  async create(args: PaymentLinkArgs): Promise<PaymentLink> {
    const wallet = await this.devdraft.defaultWallet();
    const deposit = await this.devdraft.createDeposit(wallet, args.amount);
    const instructions = deposit.source_deposit_instructions;
    const row = this.db.addPaymentLink({
      // A random token, so links cannot be guessed. The deposit id is never used in the URL.
      token: randomUUID(),
      deposit_id: deposit.id,
      recipient_email: args.email,
      description: args.description,
      amount: instructions.amount,
      currency: instructions.currency.toUpperCase(),
      network: instructions.payment_rail,
      to_address: instructions.to_address,
      fee: deposit.developer_fee ?? null,
      payee: this.db.getProfile().name || 'Sidekick user',
      email_status: 'not_configured',
    });
    const emailStatus = await this.sendEmail(row);
    this.db.setPaymentEmailStatus(row.token, emailStatus);
    return this.toLink({ ...row, email_status: emailStatus });
  }

  list() {
    return this.db.listPaymentLinks().map((row) => this.toLink(row));
  }

  publicView(token: string): PublicPaymentLink {
    const row = this.db.getPaymentLink(token);
    if (!row) throw new NotFoundException('This payment link was not found');
    return {
      description: row.description,
      payee: row.payee,
      toAddress: row.to_address,
      amount: row.amount,
      currency: row.currency,
      network: row.network,
      fee: row.fee,
      reference: row.deposit_id,
      simulated: isSimulated(row),
      createdAt: row.created_at,
    };
  }

  private async sendEmail(row: PaymentLinkRow): Promise<EmailStatus> {
    if (!this.email.configured) return 'not_configured';
    try {
      await this.email.sendPaymentLink({
        to: row.recipient_email,
        payee: row.payee,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        url: this.url(row.token),
        simulated: isSimulated(row),
      });
      return 'sent';
    } catch (error) {
      this.logger.warn(`Payment email failed: ${String(error)}`);
      return 'failed';
    }
  }

  private url(token: string) {
    return `${this.config.webOrigin}/pay/${token}`;
  }

  private toLink(row: PaymentLinkRow): PaymentLink {
    return {
      token: row.token,
      url: this.url(row.token),
      recipientEmail: row.recipient_email,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      network: row.network,
      emailStatus: row.email_status,
      simulated: isSimulated(row),
      createdAt: row.created_at,
    };
  }
}
