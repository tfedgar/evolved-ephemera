import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { parse } from 'parse5';

const runtimeUrl = import.meta.resolve('astro/compiler-runtime');

async function component(filename: string) {
  let source = await readFile(new URL(`../src/components/${filename}`, import.meta.url), 'utf8');
  source = source.replace(/<(script|style)>[\s\S]*?<\/\1>/g, '');
  for (const module of ['coaching-plans', 'inquiry']) {
    source = source.replaceAll(`'../lib/${module}'`, JSON.stringify(new URL(`../src/lib/${module}.ts`, import.meta.url).href));
  }
  const result = await transform(source, { filename, internalURL: runtimeUrl, resultScopedSlot: true });
  const code = result.code.replace(',\n  createMetadata as $$createMetadata', '')
    .replace(/^export const \$\$metadata = .*;\n/m, '');
  return (await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code, { mode: 'strip' })).toString('base64')}`)).default;
}

async function render(filename: string, search = '') {
  const container = await AstroContainer.create();
  const response = await container.renderToResponse(await component(filename), {
    request: new Request(`https://coachedgar.example/${search}`),
  });
  const elements: any[] = [];
  const visit = (node: any) => {
    if (node.tagName) elements.push(node);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(await response.text()));
  return elements;
}

const attributes = (node: any): Record<string, string> => Object.fromEntries(node.attrs.map((attr: any) => [attr.name, attr.value]));
const findById = (nodes: any[], id: string) => nodes.find(node => attributes(node).id === id);

test('each pricing action leads to the matching optional, editable commitment in the native inquiry form', async () => {
  const pricing = await render('CoachingPricing.astro');
  const actions = pricing.filter(node => node.tagName === 'a').map(attributes)
    .filter(action => Object.hasOwn(action, 'data-inquiry-program'));
  assert.deepEqual(actions.map(action => action.href), [
    '/?program=three-month#contact', '/?program=six-month#contact', '/?program=twelve-month#contact',
  ]);
  assert.deepEqual(actions.map(action => action['data-inquiry-program']), ['three-month', 'six-month', 'twelve-month']);
  for (const [query, expected] of [
    ['?program=three-month', 'three-month'], ['?program=six-month', 'six-month'], ['?program=twelve-month', 'twelve-month'],
  ]) {
    const inquiry = await render('ContactSection.astro', query);
    const select = findById(inquiry, 'inquiry-commitment');
    assert.ok(select, 'a commitment control renders');
    assert.equal(select.tagName, 'select');
    assert.equal(attributes(select).name, 'commitment-interest');
    assert.ok(!Object.hasOwn(attributes(select), 'required'));
    assert.ok(!Object.hasOwn(attributes(select), 'disabled'));
    const selected = select.childNodes.filter((node: any) => node.tagName === 'option' && Object.hasOwn(attributes(node), 'selected'));
    assert.deepEqual(selected.map(attributes).map((option: Record<string, string>) => option.value), [expected]);
  }
});

test('generic, unknown and repeated query values render no commitment preference', async () => {
  for (const query of ['', '?program=unrecognized', '?program=three-month&program=three-month', '?program=three-month&program=twelve-month']) {
    const inquiry = await render('ContactSection.astro', query);
    const select = findById(inquiry, 'inquiry-commitment');
    assert.ok(select, 'the generic inquiry retains an optional commitment control');
    const selected = select.childNodes.filter((node: any) => node.tagName === 'option' && Object.hasOwn(attributes(node), 'selected'));
    assert.deepEqual(selected.map(attributes).map((option: Record<string, string>) => option.value), [''], query);
  }
});

test('inquiry enhancement retains native POST, direct email, required contact fields and an accessible status region', async () => {
  const inquiry = await render('ContactSection.astro');
  const form = inquiry.find(node => node.tagName === 'form');
  assert.equal(attributes(form).action, 'https://formspree.io/f/xjkogark');
  assert.equal(attributes(form).method.toUpperCase(), 'POST');
  assert.ok(!Object.hasOwn(attributes(form), 'novalidate'));
  assert.ok(inquiry.some(node => node.tagName === 'a' && attributes(node).href === 'mailto:info@coachedgar.com'));
  for (const id of ['inquiry-name', 'inquiry-email']) {
    assert.ok(Object.hasOwn(attributes(findById(inquiry, id)), 'required'));
  }
  const submit = inquiry.find(node => node.tagName === 'button' && attributes(node).type === 'submit');
  assert.ok(!Object.hasOwn(attributes(submit), 'disabled'), 'no-JavaScript visitors can submit');
  const status = findById(inquiry, 'inquiry-status');
  assert.ok(status, 'submission feedback has a persistent region');
  assert.equal(attributes(status).role, 'status');
  assert.equal(attributes(status)['aria-live'], 'polite');
  assert.equal(attributes(status)['aria-atomic'], 'true');
});
