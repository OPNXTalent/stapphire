import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUncachedFetch } from './uncachedFetch.ts';

test('uncached fetch preserves a Request and changes only cache semantics', async () => {
  const controller = new AbortController();
  const request = new Request('https://example.test/rest/v1/phase1_operations', {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'test' }),
    signal: controller.signal,
    cache: 'force-cache'
  });
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  const baseFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedInput = input;
    capturedInit = init;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  await createUncachedFetch(baseFetch)(request);

  assert.equal(capturedInput, request, 'the original Request object is passed through unchanged');
  assert.deepEqual(capturedInit, { cache: 'no-store' });
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('authorization'), 'Bearer test');
  assert.equal(request.headers.get('content-type'), 'application/json');
  assert.equal(request.signal.aborted, controller.signal.aborted, 'the Request retains the supplied signal semantics');
  assert.equal(await request.text(), JSON.stringify({ operation: 'test' }), 'the request body remains intact and readable');
  controller.abort();
  assert.equal(request.signal.aborted, true, 'abort propagation remains intact');
});

test('uncached fetch preserves every supplied init field while overriding only cache', async () => {
  const controller = new AbortController();
  const headers = new Headers({ prefer: 'return=representation' });
  const body = JSON.stringify({ id: 'operation-id' });
  const originalInit: RequestInit = {
    method: 'PATCH',
    headers,
    body,
    signal: controller.signal,
    credentials: 'include',
    redirect: 'manual',
    integrity: 'sha256-test',
    keepalive: true,
    cache: 'force-cache'
  };
  let capturedInit: RequestInit | undefined;
  const baseFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  await createUncachedFetch(baseFetch)('https://example.test/rest/v1/phase1_operations', originalInit);

  assert.deepEqual(capturedInit, { ...originalInit, cache: 'no-store' });
  assert.equal(capturedInit?.method, originalInit.method);
  assert.equal(capturedInit?.headers, headers);
  assert.equal(capturedInit?.body, body);
  assert.equal(capturedInit?.signal, controller.signal);
});
