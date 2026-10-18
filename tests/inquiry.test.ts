import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInquirySubmission, resolveInquiryCommitment } from '../src/lib/inquiry.ts';

test('a single known initial commitment can be carried into an inquiry', () => {
  assert.equal(resolveInquiryCommitment('?program=three-month'), 'three-month');
  assert.equal(resolveInquiryCommitment('?program=six-month&source=pricing'), 'six-month');
  assert.equal(resolveInquiryCommitment('?program=twelve-month'), 'twelve-month');
});

test('absent, invalid and repeated commitments leave the choice open', () => {
  for (const query of [
    '', '?program=', '?program=unknown', '?program=Three-month',
    '?program=three-month&program=six-month', '?program=six-month&program=six-month',
    '?program=unknown&program=twelve-month', '?program[]=three-month',
  ]) {
    assert.equal(resolveInquiryCommitment(query), '', query);
  }
});

function inquiryData() {
  const body = new FormData();
  body.set('full-name', 'Fixture Visitor');
  body.set('email', 'visitor@example.test');
  body.set('commitment-interest', 'six-month');
  body.set('broad-goals', 'Make a practical plan for travel weeks.');
  return body;
}

test('submission exposes pending until the provider accepts the actual inquiry payload', async () => {
  const states: string[] = [];
  const requests: { input: unknown; init: RequestInit | undefined }[] = [];
  let accept: (response: Response) => void = () => { throw new Error('request has not started'); };
  const body = inquiryData();
  const submission = createInquirySubmission({
    action: 'https://forms.example.test/inquiry',
    send: async (input, init) => {
      requests.push({ input, init });
      return new Promise<Response>(resolve => { accept = resolve; });
    },
    onState: state => states.push(state.status),
  });

  const pending = submission.submit(body);
  assert.deepEqual(states, ['pending']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'https://forms.example.test/inquiry');
  assert.equal(requests[0].init?.method, 'POST');
  assert.equal(new Headers(requests[0].init?.headers).get('accept'), 'application/json');
  assert.equal(requests[0].init?.body, body, 'the submitted payload retains the editable interest and inquiry');
  assert.equal(body.get('commitment-interest'), 'six-month');

  accept(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.equal(await pending, 'accepted');
  assert.deepEqual(states, ['pending', 'accepted']);
});

test('repeat submission while pending cannot issue another request', async () => {
  let requests = 0;
  let accept: (response: Response) => void = () => { throw new Error('request has not started'); };
  const states: string[] = [];
  const submission = createInquirySubmission({
    action: 'https://forms.example.test/inquiry',
    send: async () => {
      requests += 1;
      return new Promise<Response>(resolve => { accept = resolve; });
    },
    onState: state => states.push(state.status),
  });
  const pending = submission.submit(inquiryData());
  assert.equal(await submission.submit(inquiryData()), 'pending');
  assert.equal(requests, 1);
  assert.deepEqual(states, ['pending']);
  accept(new Response(null, { status: 202 }));
  await pending;
  assert.equal(await submission.submit(inquiryData()), 'accepted');
  assert.equal(requests, 1, 'an already accepted request is not submitted again');
});

test('provider rejection preserves entered data and permits an edited retry', async () => {
  const states: string[] = [];
  const payloads: string[] = [];
  const body = inquiryData();
  const submission = createInquirySubmission({
    action: 'https://forms.example.test/inquiry',
    send: async (_input, init) => {
      payloads.push((init?.body as FormData).get('email') as string);
      return payloads.length === 1
        ? new Response(JSON.stringify({ errors: [{ field: 'email', message: 'Invalid email' }] }), { status: 422 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    onState: state => states.push(state.status),
  });

  assert.equal(await submission.submit(body), 'provider-error');
  assert.deepEqual([...body.entries()], [
    ['full-name', 'Fixture Visitor'], ['email', 'visitor@example.test'],
    ['commitment-interest', 'six-month'], ['broad-goals', 'Make a practical plan for travel weeks.'],
  ]);
  body.set('email', 'corrected@example.test');
  body.set('commitment-interest', '');
  assert.equal(await submission.submit(body), 'accepted');
  assert.deepEqual(payloads, ['visitor@example.test', 'corrected@example.test']);
  assert.equal(body.get('commitment-interest'), '', 'no preference remains a valid editable choice');
  assert.deepEqual(states, ['pending', 'provider-error', 'pending', 'accepted']);
});

test('a network failure never reports acceptance and leaves a retry available', async () => {
  const states: string[] = [];
  const body = inquiryData();
  let requests = 0;
  const submission = createInquirySubmission({
    action: 'https://forms.example.test/inquiry',
    send: async () => {
      requests += 1;
      if (requests === 1) throw new TypeError('Fixture network unavailable');
      return new Response(null, { status: 202 });
    },
    onState: state => states.push(state.status),
  });

  assert.equal(await submission.submit(body), 'network-error');
  assert.equal(body.get('broad-goals'), 'Make a practical plan for travel weeks.');
  assert.deepEqual(states, ['pending', 'network-error']);
  assert.equal(await submission.submit(body), 'accepted');
  assert.deepEqual(states, ['pending', 'network-error', 'pending', 'accepted']);
});

test('all provider failure statuses remain failures, including rate limits and outages', async () => {
  for (const status of [400, 403, 422, 429, 500, 503]) {
    const states: string[] = [];
    const submission = createInquirySubmission({
      action: 'https://forms.example.test/inquiry',
      send: async () => new Response(null, { status }),
      onState: state => states.push(state.status),
    });
    assert.equal(await submission.submit(inquiryData()), 'provider-error', `HTTP ${status}`);
    assert.deepEqual(states, ['pending', 'provider-error']);
  }
});
