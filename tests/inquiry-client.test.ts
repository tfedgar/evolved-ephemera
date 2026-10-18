import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createInquirySubmission, resolveInquiryCommitment } from '../src/lib/inquiry.ts';

class Element extends EventTarget {
  value = '';
  disabled = false;
  textContent = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  focused = false;
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  focus() { this.focused = true; }
  scrollIntoView() {}
}

async function runClient(options: { query?: string; restoredCommitment?: string; send?: typeof fetch } = {}) {
  const source = await readFile(new URL('../src/components/ContactSection.astro', import.meta.url), 'utf8');
  const clientSource = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(clientSource, 'the actual component client initializer is exercised');
  const form = Object.assign(new Element(), { action: 'https://forms.example.test/inquiry', reportValidity: () => true });
  const controls = new Map<string, Element>([
    ['full-name', new Element()], ['email', new Element()],
    ['commitment-interest', new Element()], ['broad-goals', new Element()],
  ]);
  controls.get('full-name')!.value = 'Fixture Visitor';
  controls.get('email')!.value = 'visitor@example.test';
  controls.get('broad-goals')!.value = 'Keep a useful plan during travel.';
  controls.get('commitment-interest')!.value = options.restoredCommitment ?? '';
  const status = new Element();
  const button = new Element();
  button.textContent = 'Request a call';
  const querySelector = (selector: string) => ({
    '#inquiry-status': status, 'button[type="submit"]': button,
    '#inquiry-commitment': controls.get('commitment-interest'),
  })[selector] ?? null;
  Object.assign(form, { querySelector, querySelectorAll: () => [...controls.values()] });
  const links = ['three-month', 'six-month', 'twelve-month'].map(id => Object.assign(new Element(), {
    href: `https://coachedgar.example/?program=${id}#contact`,
  }));
  let location = new URL(`https://coachedgar.example/${options.query ?? ''}`);
  const entries = [location.href];
  let index = 0;
  const window = Object.assign(new EventTarget(), {
    fetch: options.send ?? (async () => { throw new Error('History checks must not send an inquiry'); }),
  });
  Object.defineProperty(window, 'location', { get: () => location });
  const history = {
    pushState(_state: unknown, _title: string, url: string | URL) {
      location = new URL(url, location);
      entries.splice(index + 1);
      entries.push(location.href);
      index += 1;
    },
    back() {
      if (index > 0) { index -= 1; location = new URL(entries[index]); window.dispatchEvent(new Event('popstate')); }
    },
    forward() {
      if (index + 1 < entries.length) { index += 1; location = new URL(entries[index]); window.dispatchEvent(new Event('popstate')); }
    },
  };
  class FixtureFormData extends FormData {
    constructor(_form: typeof form) {
      super();
      for (const [name, control] of controls) if (!control.disabled) this.set(name, control.value);
    }
  }
  runInNewContext(stripTypeScriptTypes(clientSource.replace(/^\s*import\s+\{[^}]+\}\s+from\s+['"]\.\.\/lib\/inquiry['"];\s*$/m, ''), { mode: 'strip' }), {
    createInquirySubmission, resolveInquiryCommitment, URL, window, history, FormData: FixtureFormData,
    document: {
      querySelector: (selector: string) => selector === '[data-inquiry-form]' ? form : null,
      querySelectorAll: () => links,
      getElementById: () => new Element(),
    },
  }, { filename: 'inquiry-client.ts' });
  return {
    form, controls, status, button, history, window,
    location: () => location,
    clickPlan(id: string) {
      const link = links.find(link => link.href.includes(`program=${id}`));
      assert.ok(link);
      const click = new Event('click', { cancelable: true });
      Object.defineProperties(click, { button: { value: 0 }, metaKey: { value: false }, ctrlKey: { value: false }, shiftKey: { value: false }, altKey: { value: false } });
      link.dispatchEvent(click);
      assert.ok(click.defaultPrevented, 'same-page pricing navigation is progressively enhanced');
    },
    submit() { form.dispatchEvent(new Event('submit', { cancelable: true })); },
  };
}

test('actual client Back and Forward synchronize the commitment while retaining all other inquiry inputs', async () => {
  const client = await runClient();
  const commitment = client.controls.get('commitment-interest')!;
  client.clickPlan('three-month');
  client.clickPlan('six-month');
  assert.equal(commitment.value, 'six-month');
  client.history.back();
  assert.equal(client.location().search, '?program=three-month');
  assert.equal(commitment.value, 'three-month');
  client.history.back();
  assert.equal(client.location().search, '');
  assert.equal(commitment.value, '');
  client.history.forward();
  assert.equal(commitment.value, 'three-month');
  client.history.forward();
  assert.equal(commitment.value, 'six-month');
  assert.equal(client.controls.get('full-name')!.value, 'Fixture Visitor');
  assert.equal(client.controls.get('email')!.value, 'visitor@example.test');
  assert.equal(client.controls.get('broad-goals')!.value, 'Keep a useful plan during travel.');
});

test('actual client history navigation to unknown and repeated program queries restores no preference', async () => {
  for (const query of ['?program=unrecognized', '?program=three-month&program=six-month', '?program=three-month&program=three-month']) {
    const client = await runClient({ query });
    client.clickPlan('twelve-month');
    client.history.back();
    assert.equal(client.location().search, query);
    assert.equal(client.controls.get('commitment-interest')!.value, '', query);
    client.history.forward();
    assert.equal(client.controls.get('commitment-interest')!.value, 'twelve-month');
  }
});

test('actual client initialization and same-query history events preserve browser-restored or edited choices', async () => {
  const client = await runClient({ query: '?program=three-month', restoredCommitment: 'twelve-month' });
  const commitment = client.controls.get('commitment-interest')!;
  assert.equal(commitment.value, 'twelve-month');
  client.window.dispatchEvent(new Event('popstate'));
  assert.equal(commitment.value, 'twelve-month', 'initial same-URL popstate cannot overwrite restored data');
  commitment.value = 'six-month';
  client.history.pushState(null, '', '#contact');
  client.history.back();
  assert.equal(commitment.value, 'six-month', 'fragment-only history preserves a manual choice');
});

test('actual client pending and provider failure feedback blocks duplicates and restores retry without clearing values', async () => {
  let respond: (response: Response) => void = () => { throw new Error('request has not started'); };
  const requests: FormData[] = [];
  const client = await runClient({ send: async (_input, init) => {
    requests.push(init!.body as FormData);
    return new Promise<Response>(resolve => { respond = resolve; });
  } });
  client.controls.get('commitment-interest')!.value = 'six-month';
  client.submit();
  client.submit();
  assert.equal(requests.length, 1);
  assert.equal(client.button.disabled, true);
  assert.ok([...client.controls.values()].every(control => control.disabled), 'all submitted fields lock while pending');
  assert.equal(client.form.getAttribute('aria-busy'), 'true');
  assert.equal(client.status.dataset.state, 'pending');
  assert.equal(requests[0].get('commitment-interest'), 'six-month');
  respond(new Response(null, { status: 422 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.button.disabled, false);
  assert.ok([...client.controls.values()].every(control => !control.disabled), 'provider failure restores editing');
  assert.equal(client.form.getAttribute('aria-busy'), 'false');
  assert.equal(client.status.dataset.state, 'provider-error');
  assert.equal(client.status.focused, true);
  assert.equal(client.controls.get('full-name')!.value, 'Fixture Visitor');
  assert.equal(client.controls.get('broad-goals')!.value, 'Keep a useful plan during travel.');
  client.controls.get('email')!.value = 'corrected@example.test';
  client.submit();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].get('email'), 'corrected@example.test');
  respond(new Response(null, { status: 202 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.status.dataset.state, 'accepted');
  assert.equal(client.button.disabled, true);
  assert.ok([...client.controls.values()].every(control => control.disabled), 'accepted values remain the values that were sent');
});

test('actual client captures the complete payload before locking and freezes it across pricing and history navigation', async () => {
  let respond: (response: Response) => void = () => { throw new Error('request has not started'); };
  const requests: FormData[] = [];
  const client = await runClient({ send: async (_input, init) => {
    requests.push(init!.body as FormData);
    return new Promise<Response>(resolve => { respond = resolve; });
  } });
  client.clickPlan('three-month');
  client.clickPlan('six-month');
  client.submit();
  assert.deepEqual([...requests[0].entries()], [
    ['full-name', 'Fixture Visitor'], ['email', 'visitor@example.test'],
    ['commitment-interest', 'six-month'], ['broad-goals', 'Keep a useful plan during travel.'],
  ], 'disabling controls before taking FormData would silently omit the request fields');
  assert.ok([...client.controls.values()].every(control => control.disabled));
  client.clickPlan('twelve-month');
  assert.equal(client.location().search, '?program=six-month', 'pricing cannot navigate the pending request');
  assert.equal(client.controls.get('commitment-interest')!.value, 'six-month');
  client.history.back();
  assert.equal(client.location().search, '?program=three-month');
  assert.equal(client.controls.get('commitment-interest')!.value, 'six-month', 'history cannot replace the pending snapshot');
  respond(new Response(null, { status: 202 }));
  await new Promise(resolve => setImmediate(resolve));
  client.clickPlan('twelve-month');
  assert.equal(client.location().search, '?program=three-month', 'pricing cannot navigate the accepted request');
  client.history.back();
  assert.equal(client.location().search, '');
  assert.equal(client.controls.get('commitment-interest')!.value, 'six-month', 'history cannot replace the accepted snapshot');
  assert.equal(client.controls.get('email')!.value, 'visitor@example.test');
  assert.ok([...client.controls.values()].every(control => control.disabled));
  assert.equal(requests.length, 1);
});

test('actual client network failure unlocks the retained fields for a corrected retry', async () => {
  let attempts = 0;
  const requests: FormData[] = [];
  const client = await runClient({ send: async (_input, init) => {
    requests.push(init!.body as FormData);
    attempts += 1;
    if (attempts === 1) throw new TypeError('Fixture connection failure');
    return new Response(null, { status: 202 });
  } });
  client.submit();
  assert.ok([...client.controls.values()].every(control => control.disabled));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.status.dataset.state, 'network-error');
  assert.equal(client.button.disabled, false);
  assert.ok([...client.controls.values()].every(control => !control.disabled));
  assert.equal(client.controls.get('email')!.value, 'visitor@example.test');
  assert.equal(client.controls.get('broad-goals')!.value, 'Keep a useful plan during travel.');
  client.controls.get('email')!.value = 'corrected@example.test';
  client.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[1].get('email'), 'corrected@example.test');
  assert.equal(client.status.dataset.state, 'accepted');
  assert.ok([...client.controls.values()].every(control => control.disabled));
});
