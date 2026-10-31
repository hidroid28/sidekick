import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentLinkArgsSchema } from '@sidekick/shared';
import { DevdraftClient } from '../src/payments/devdraft.client.js';
import { buildPaymentEmail, EmailService } from '../src/payments/email.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { FakeModel, makeServices, testConfig } from './helpers.js';

const WALLET = { id: 'wallet-1', address: '0xabc', chain: 'base', balances: null };
const DEPOSIT = {
  id: 'deposit:wa_1:uuid',
  state: 'awaiting_funds',
  developer_fee: '0.8',
  source_deposit_instructions: { payment_rail: 'base', currency: 'usdc', to_address: '0xabc', amount: '25' },
};
const ARGS = { email: 'client@example.com', amount: 25, description: 'Uniforms' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function devdraftFetch(deposit: Response | (() => Response) = () => json(DEPOSIT, 201), wallet = () => json(WALLET)) {
  const mock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/wallets/default')) return wallet();
    return typeof deposit === 'function' ? deposit() : deposit;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function setup(email = false) {
  const services = makeServices(new FakeModel([]), testConfig({
    devdraftKey: 'key-1',
    devdraftSecret: 'secret-1',
    webOrigin: 'https://sidekick.test',
    ...(email ? { resendApiKey: 'resend-key', emailFrom: 'me@test' } : {}),
  }));
  const send = vi.spyOn(services.email, 'sendPaymentLink').mockResolvedValue();
  return { ...services, send };
}

afterEach(() => vi.unstubAllGlobals());

describe('DevdraftClient', () => {
  it('sends the secrets in headers, and the wallet details in the deposit', async () => {
    const mock = devdraftFetch();
    const { payments } = setup();
    await payments.create(ARGS);
    const [url, init] = mock.mock.calls[1]!;
    expect(url).toBe('https://api.devdraft.ai/api/v0/transfers/direct-wallet');
    expect(url).not.toContain('secret-1');
    expect(init!.headers).toMatchObject({ 'x-client-key': 'key-1', 'x-client-secret': 'secret-1' });
    expect(JSON.parse(String(init!.body))).toEqual({
      walletId: 'wallet-1', network: 'base', stableCoinCurrency: 'usdc', amount: 25,
    });
  });

  it('refuses to call Devdraft with no keys', async () => {
    const mock = devdraftFetch();
    const { payments } = makeServices(new FakeModel([]));
    await expect(payments.create(ARGS)).rejects.toThrow('Payments are not set up yet.');
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'Check the payment details'],
    [401, 'Payments are unavailable.'],
    [403, "can't receive payments yet"],
    [404, 'wallet changed'],
    [500, 'Something went wrong'],
  ])('shows a safe message for a %i on deposit', async (status, message) => {
    devdraftFetch(() => json({ message: 'internal detail' }, status));
    const { payments } = setup();
    const failure = payments.create(ARGS);
    await expect(failure).rejects.toThrow(message);
    await expect(failure).rejects.not.toThrow('internal detail');
  });

  it('reports the no-wallet state as unavailable', async () => {
    devdraftFetch(undefined, () => json({ statusCode: 404 }, 404));
    expect(await setup().payments.walletStatus()).toEqual({
      available: false, message: 'Payments unlock after identity verification.', emailConfigured: false, simulated: false,
    });
  });

  it('reports the network when a wallet exists', async () => {
    devdraftFetch();
    expect(await setup().payments.walletStatus()).toMatchObject({ available: true, network: 'base' });
  });

  it('handles a network failure safely', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('secret socket detail'); });
    await expect(setup().payments.create(ARGS)).rejects.toThrow('Something went wrong. Try again.');
  });

  it('accepts numeric amounts and a missing fee', async () => {
    const { developer_fee: _fee, ...rest } = DEPOSIT;
    devdraftFetch(() => json({
      ...rest,
      source_deposit_instructions: { ...DEPOSIT.source_deposit_instructions, amount: 25 },
    }, 201));
    const { payments } = setup();
    const link = await payments.create(ARGS);
    expect(link.amount).toBe('25');
    expect(payments.publicView(link.token).fee).toBeNull();
  });
});

describe('PaymentsService', () => {
  it('creates one deposit per link, with an unguessable URL', async () => {
    const mock = devdraftFetch();
    const link = await setup().payments.create(ARGS);
    expect(mock.mock.calls.filter(([url]) => url.includes('direct-wallet'))).toHaveLength(1);
    expect(link.url).toMatch(/^https:\/\/sidekick\.test\/pay\/[0-9a-f-]{36}$/);
    expect(link.url).not.toContain('deposit');
  });

  it('emails the link when email is set up', async () => {
    devdraftFetch();
    const { payments, send } = setup(true);
    const link = await payments.create(ARGS);
    expect(link.emailStatus).toBe('sent');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ARGS.email, currency: 'USDC', url: link.url }));
    expect(payments.list()[0]!.emailStatus).toBe('sent');
  });

  it('keeps the link when no email service is set up', async () => {
    devdraftFetch();
    const { payments, send } = setup();
    expect((await payments.create(ARGS)).emailStatus).toBe('not_configured');
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the link when the email fails', async () => {
    devdraftFetch();
    const { payments, send } = setup(true);
    send.mockRejectedValue(new Error('smtp down'));
    expect((await payments.create(ARGS)).emailStatus).toBe('failed');
    expect(payments.list()).toHaveLength(1);
  });

  it('does not expose the recipient on the public view', async () => {
    devdraftFetch();
    const { payments } = setup();
    const link = await payments.create(ARGS);
    const view = payments.publicView(link.token);
    expect(JSON.stringify(view)).not.toContain(ARGS.email);
    expect(view).toMatchObject({ toAddress: '0xabc', amount: '25', currency: 'USDC', network: 'base', fee: '0.8' });
  });

  it('rejects an unknown token', () => {
    expect(() => setup().payments.publicView('nope')).toThrow('not found');
  });
});

describe('send_payment_link tool', () => {
  const skill = { name: 's', description: 'd', allowedTools: ['send_payment_link'], body: '' };
  const call = { tool: 'send_payment_link', args: ARGS };

  it('is blocked with no skill, and creates nothing', async () => {
    const mock = devdraftFetch();
    const { tools, db } = setup();
    const { id } = db.createConversation('t');
    expect(await tools.dispatch(call, { conversationId: id })).toMatchObject({ kind: 'result' });
    expect(mock).not.toHaveBeenCalled();
  });

  it('asks for approval first, showing the recipient and amount', async () => {
    const mock = devdraftFetch();
    const { tools, db } = setup();
    const { id } = db.createConversation('t');
    const outcome = await tools.dispatch(call, { conversationId: id, skill });
    expect(outcome).toMatchObject({
      kind: 'approval',
      approval: { summary: 'Email a payment link for 25.00 USDC to client@example.com: Uniforms' },
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('rejects a bad email address', async () => {
    const { tools, db } = setup();
    const { id } = db.createConversation('t');
    const outcome = await tools.dispatch({ ...call, args: { ...ARGS, email: 'nope' } }, { conversationId: id, skill });
    expect(outcome).toMatchObject({ kind: 'result', text: expect.stringContaining('email') });
  });

  const run = async (email: boolean) => {
    const services = setup(email);
    const { id } = services.db.createConversation('t');
    const pendingId = services.db.createPending(id, 'send_payment_link', ARGS, 's');
    return { ...services, result: () => services.tools.execute(services.db.getPending(pendingId)!) };
  };

  it('reports a sent email', async () => {
    devdraftFetch();
    const { result } = await run(true);
    expect(await result()).toBe('Saved. Payment link for 25 USDC emailed to client@example.com.');
  });

  it('says plainly when the link was not emailed, and gives the link', async () => {
    devdraftFetch();
    const { result } = await run(false);
    const text = await result();
    expect(text).toContain('NOT emailed');
    expect(text).toContain('https://sidekick.test/pay/');
  });

  it('reports a Devdraft failure instead of throwing', async () => {
    devdraftFetch(() => json({}, 403));
    const { result } = await run(true);
    expect(await result()).toBe("Error: no payment link was created. This account can't receive payments yet.");
  });
});

describe('simulated Devdraft', () => {
  const simulated = (extra = {}) => {
    const services = makeServices(new FakeModel([]), testConfig({ devdraftSimulate: true, webOrigin: 'https://sidekick.test', ...extra }));
    return { ...services, send: vi.spyOn(services.email, 'sendPaymentLink').mockResolvedValue() };
  };

  it('never calls Devdraft, and needs no keys', async () => {
    const mock = devdraftFetch();
    const { payments } = simulated();
    expect(await payments.walletStatus()).toMatchObject({ available: true, network: 'base', simulated: true });
    await payments.create(ARGS);
    expect(mock).not.toHaveBeenCalled();
  });

  it('ignores real keys while the setting is on', async () => {
    const mock = devdraftFetch();
    await simulated({ devdraftKey: 'k', devdraftSecret: 's' }).payments.create(ARGS);
    expect(mock).not.toHaveBeenCalled();
  });

  it('labels the link, and uses an address that cannot receive funds', async () => {
    devdraftFetch();
    const { payments } = simulated();
    const link = await payments.create(ARGS);
    const view = payments.publicView(link.token);
    expect(link.simulated).toBe(true);
    expect(view.simulated).toBe(true);
    expect(view.toAddress).not.toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('keeps old demo links labelled after simulation is turned off', async () => {
    devdraftFetch();
    const { payments, db } = simulated();
    const link = await payments.create(ARGS);
    const row = db.getPaymentLink(link.token)!;
    const real = new PaymentsService(testConfig(), db, new DevdraftClient(testConfig()), new EmailService(testConfig()));
    expect(real.publicView(row.token).simulated).toBe(true);
  });

  it('marks the email as a demo', async () => {
    devdraftFetch();
    const { payments, send } = simulated({ resendApiKey: 'k' });
    await payments.create(ARGS);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ simulated: true }));
    const built = buildPaymentEmail({ ...send.mock.calls[0]![0] });
    expect(built.subject.startsWith('[Demo] ')).toBe(true);
    expect(built.text).toContain('Do not send any money');
    expect(built.html).toContain('Do not send any money');
  });

  it('tells the model the link is simulated', async () => {
    devdraftFetch();
    const { tools, db } = simulated();
    const { id } = db.createConversation('t');
    const pendingId = db.createPending(id, 'send_payment_link', ARGS, 's');
    expect(await tools.execute(db.getPending(pendingId)!)).toContain('simulated demo, no real payment');
  });

  it('stays off by default', () => {
    expect(testConfig().devdraftSimulate).toBe(false);
  });
});

describe('PaymentLinkArgsSchema', () => {
  it.each([
    [{ ...ARGS, email: 'nope' }],
    [{ ...ARGS, amount: 0 }],
    [{ ...ARGS, amount: -5 }],
    [{ ...ARGS, amount: 1.234 }],
    [{ ...ARGS, description: ' ' }],
  ])('rejects %j', (args) => {
    expect(PaymentLinkArgsSchema.safeParse(args).success).toBe(false);
  });

  it('accepts cents', () => {
    expect(PaymentLinkArgsSchema.safeParse({ ...ARGS, amount: 19.99 }).success).toBe(true);
  });
});

describe('buildPaymentEmail', () => {
  const email = { to: 'a@b.c', payee: 'Mwila', description: 'Uniforms', amount: '25', currency: 'USDC', url: 'https://x/pay/1' };

  it('sends through Resend with the key in a header', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => json({ id: 'email-1' }));
    vi.stubGlobal('fetch', mock);
    const config = testConfig({ resendApiKey: 'resend-key', emailFrom: 'me@test' });
    await new EmailService(config).sendPaymentLink(email);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init!.headers).toMatchObject({ authorization: 'Bearer resend-key' });
    expect(JSON.parse(String(init!.body))).toMatchObject({ from: 'me@test', to: ['a@b.c'] });
  });

  it('fails loudly when Resend rejects the email', async () => {
    vi.stubGlobal('fetch', async () => json({ message: 'domain not verified' }, 403));
    const service = new EmailService(testConfig({ resendApiKey: 'resend-key' }));
    await expect(service.sendPaymentLink(email)).rejects.toThrow('Resend 403');
  });

  it('counts as set up only with a Resend key', () => {
    expect(new EmailService(testConfig()).configured).toBe(false);
    expect(new EmailService(testConfig({ resendApiKey: 'k' })).configured).toBe(true);
  });

  it('includes the amount and the link', () => {
    const built = buildPaymentEmail(email);
    expect(built.subject).toBe('Payment request from Mwila: 25 USDC');
    expect(built.text).toContain(email.url);
    expect(built.html).toContain('href="https://x/pay/1"');
  });

  it('escapes HTML from the description and payee', () => {
    const { html } = buildPaymentEmail({ ...email, payee: '<b>x</b>', description: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x');
  });

  it('removes line breaks from the subject', () => {
    expect(buildPaymentEmail({ ...email, payee: 'A\r\nBcc: x@y.z' }).subject).not.toMatch(/[\r\n]/);
  });
});
