import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { parse } from 'parse5';

const runtimeUrl = import.meta.resolve('astro/compiler-runtime');
const asModule = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

async function compile(source: string, filename: string) {
  // Exercise the actual server page and layout; Vite handles client scripts
  // and styles separately. Neither is needed for native form referrer policy.
  const serverSource = source.replace(/<(script|style)>[\s\S]*?<\/\1>/g, '');
  const result = await transform(serverSource, {
    filename, internalURL: runtimeUrl, resultScopedSlot: true,
  });
  const code = result.code
    .replace(',\n  createMetadata as $$createMetadata', '')
    .replace(/^export const \$\$metadata = .*;\n/m, '');
  return asModule(stripTypeScriptTypes(code, { mode: 'strip' }));
}

const layoutSource = (await readFile(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8'))
  .replace('import "../styles/global.css";', '');
const layout = await compile(layoutSource, 'src/layouts/Layout.astro');
const navigation = await compile('<nav></nav>', 'FixtureNavigation.astro');
const footer = await compile('<footer></footer>', 'FixtureFooter.astro');
// Stripe alone is external. The fixture must never use the real local key or
// contact Stripe, even when rendering a return URL containing a session token.
const stripe = asModule(`export default class Stripe {
  constructor(key) { this.key = key; }
  checkout = { sessions: { retrieve: async (id) => {
    if (this.key !== 'sk_test_renderer_fixture' || id !== 'cs_test_keyIsolation') throw new Error('Unverified fixture session');
    return {
      id, mode: 'subscription', status: 'complete', payment_status: 'paid',
      currency: 'usd', amount_subtotal: 50000,
      metadata: {
        offer: 'coach-edgar-coaching-v1', plan_id: 'three-month', minimum_months: '3',
        monthly_usd: '500', minimum_commitment_usd: '1500',
        billing: 'monthly-until-cancelled', terms_acknowledged: 'yes',
      },
    };
  } } };
}`);
const pageSource = (await readFile(new URL('../src/pages/pay.astro', import.meta.url), 'utf8'))
  .replace("import Stripe from 'stripe';", `import Stripe from ${JSON.stringify(stripe)};`)
  .replace("import Layout from '../layouts/Layout.astro';", `import Layout from ${JSON.stringify(layout)};`)
  .replace("import Navigation from '../components/Navigation.astro';", `import Navigation from ${JSON.stringify(navigation)};`)
  .replace("import Footer from '../components/Footer.astro';", `import Footer from ${JSON.stringify(footer)};`)
  .replace("from '../lib/coaching-plans'", `from ${JSON.stringify(new URL('../src/lib/coaching-plans.ts', import.meta.url).href)}`)
  .replace("from '../lib/server/coaching-checkout'", `from ${JSON.stringify(new URL('../src/lib/server/coaching-checkout.ts', import.meta.url).href)}`);
const page = (await import(await compile(pageSource, 'src/pages/pay.astro'))).default;

async function renderPage(query: string, overrides: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  const response = await container.renderToResponse(page, {
    request: new Request(`https://coachedgar.example/pay${query}`),
    locals: { runtime: { env: {
      COACHING_CHECKOUT_ENABLED: 'true',
      STRIPE_COACHING_SECRET_KEY: 'sk_test_renderer_fixture',
      STRIPE_SECRET_KEY: '',
      STRIPE_COACHING_3_MONTH_PRICE_ID: 'price_fixture3',
      STRIPE_COACHING_6_MONTH_PRICE_ID: 'price_fixture6',
      STRIPE_COACHING_12_MONTH_PRICE_ID: 'price_fixture12',
      ...overrides,
    } } },
  });
  const elements: any[] = [];
  function visit(node: any) {
    if (node.tagName) elements.push(node);
    for (const child of node.childNodes || []) visit(child);
  }
  const html = await response.text();
  visit(parse(html));
  return { response, elements, html };
}

test('the rendered enrollment page permits native same-origin POSTs while suppressing cross-origin referrers', async () => {
  const { response, elements } = await renderPage('?plan=three-month');
  const attrs = (node: any) => Object.fromEntries(node.attrs.map((a: any) => [a.name, a.value]));
  // no-referrer makes native POST Origin:null. same-origin preserves its origin
  // for our CSRF guard and sends no referrer to Stripe or other external sites.
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const metaPolicies = elements.filter(node => node.tagName === 'meta')
    .map(attrs).filter(meta => meta.name === 'referrer');
  assert.ok(metaPolicies.every(meta => meta.content === 'same-origin'), 'layout must not override the response policy');
  const form = elements.find(node => node.tagName === 'form' && node.attrs.some((a: any) => a.name === 'data-coaching-checkout'));
  assert.ok(form, 'the real enrollment form renders');
  assert.equal(attrs(form).action, '/api/create-checkout-session');
  assert.equal(attrs(form).method.toLowerCase(), 'post');
  const acknowledgement = elements.find(node => node.tagName === 'input' && attrs(node).name === 'termsAcknowledged');
  assert.equal(attrs(acknowledgement).value, 'yes');
  assert.ok(!Object.hasOwn(attrs(acknowledgement), 'disabled'));
});

test('enrollment shows the guarantee and its minimum-term exception before a client acknowledges billing', async () => {
  // Client scripts are absent in this renderer: the disclosure must be readable
  // before any interaction, including when JavaScript is unavailable.
  const { elements } = await renderPage('?plan=six-month');
  const attrs = (node: any) => Object.fromEntries((node.attrs ?? []).map((a: any) => [a.name, a.value]));
  const text = (node: any): string => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join(' ');
  const guarantee = elements.find(node => attrs(node).id === 'coaching-guarantee-summary');
  const acknowledgement = elements.find(node => node.tagName === 'input' && attrs(node).name === 'termsAcknowledged');
  assert.ok(guarantee, 'a guarantee summary must render beside the billing details');
  assert.ok(acknowledgement, 'the billing acknowledgement must render');
  assert.ok(elements.indexOf(guarantee) < elements.indexOf(acknowledgement), 'the guarantee must be disclosed before agreement');
  for (let node = guarantee; node; node = node.parentNode) {
    const attributes = attrs(node);
    assert.ok(!Object.hasOwn(attributes, 'hidden') && !Object.hasOwn(attributes, 'inert'));
    assert.notEqual(attributes['aria-hidden'], 'true');
    assert.doesNotMatch(attributes.style ?? '', /display\s*:\s*none|visibility\s*:\s*hidden/i);
  }
  const disclosure = text(guarantee).replace(/\s+/g, ' ');
  assert.match(disclosure, /14.day (?:money.back )?guarantee/i);
  assert.match(disclosure, /new clients[^.]*once per person/i);
  assert.match(disclosure, /full first monthly coaching payment[^.]*applicable tax/i);
  assert.match(disclosure, /info@coachedgar\.com[^.]*within 14 calendar days of (?:the )?agreed coaching start/i);
  assert.match(disclosure, /timely claim[^.]*cancels coaching and billing[^.]*waives[^.]*remaining minimum commitment/i);
  assert.match(disclosure, /independently billed clinic[^.]*lab[^.]*medication[^.]*excluded/i);
  const termsLink = elements.find(node => node.tagName === 'a' && attrs(node).href === '/terms#coaching-guarantee');
  assert.ok(termsLink && elements.indexOf(termsLink) < elements.indexOf(acknowledgement), 'full guarantee terms must be linked before agreement');
  assert.match(text(acknowledgement.parentNode), /minimum commitment[^.]*subject to[^.]*14.day guarantee exception/i);
  const billing = elements.find(node => attrs(node).id === 'billing-summary');
  assert.match(text(billing).replace(/\s+/g, ' '), /agree[^.]*start date[^.]*first.payment date[^.]*claim deadline[^.]*before pay/i);
});

test('a token-bearing checkout return stays private without restoring an external referrer', async () => {
  const { response, elements } = await renderPage('?session_id=cs_test_privateReturnToken');
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const canonical = elements.find(node => node.tagName === 'link' && node.attrs.some((a: any) => a.name === 'rel' && a.value === 'canonical'));
  assert.equal(canonical.attrs.find((a: any) => a.name === 'href')?.value, 'https://www.coachedgar.com/pay');
});

test('a legacy Stripe credential alone cannot enable enrollment or verify a coaching payment', async () => {
  const { elements, html } = await renderPage('?session_id=cs_test_keyIsolation', {
    STRIPE_COACHING_SECRET_KEY: '',
    STRIPE_SECRET_KEY: 'sk_test_legacy_fixture',
  });
  const button = elements.find(node => node.tagName === 'button' && node.attrs.some((a: any) => a.name === 'type' && a.value === 'submit'));
  assert.ok(button.attrs.some((a: any) => a.name === 'disabled'), 'legacy credentials must not open coaching enrollment');
  assert.ok(html.includes('Payment has not been verified.'));
  assert.ok(!html.includes('Your first payment is confirmed.'));
});

test('a coaching return uses its dedicated credential despite a conflicting legacy credential', async () => {
  const { html } = await renderPage('?session_id=cs_test_keyIsolation', {
    STRIPE_SECRET_KEY: 'sk_test_legacy_fixture',
  });
  assert.ok(html.includes('Your first payment is confirmed.'));
  assert.ok(!html.includes('Payment has not been verified.'));
});
