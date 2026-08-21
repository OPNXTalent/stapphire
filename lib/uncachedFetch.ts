export function createUncachedFetch(baseFetch: typeof fetch = globalThis.fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => baseFetch(input, {
    ...init,
    cache: 'no-store'
  })) as typeof fetch;
}
