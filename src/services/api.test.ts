import {afterEach, expect, test} from 'bun:test';

const {api, ApiRequestError} = await import('./api.ts');
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test.each([429, 503])('API retries HTTP %i responses and succeeds', async (status) => {
    let attempts = 0;
    globalThis.fetch = (async () => {
        attempts++;
        return attempts < 3 ? new Response('{"error":"down"}', {status}) : new Response('{"success":true}', {status: 200});
    }) as unknown as typeof fetch;

    await expect(api.request('GET', '/retry-test')).resolves.toEqual({success: true});
    expect(attempts).toBe(3);
});

test('API does not retry validation failures', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
        attempts++;
        return new Response('{"error":"invalid"}', {status: 422});
    }) as unknown as typeof fetch;

    await expect(api.request('POST', '/validation-test', {})).rejects.toBeInstanceOf(ApiRequestError);
    expect(attempts).toBe(1);
});

test.each([new TypeError('Connection failed'), new DOMException('Timed out', 'TimeoutError')])(
    'API retries transport failures: %s',
    async (error) => {
        let attempts = 0;
        globalThis.fetch = (async () => {
            if (++attempts === 1) throw error;
            return new Response('{"success":true}');
        }) as unknown as typeof fetch;

        await expect(api.request('GET', '/transport-test')).resolves.toEqual({success: true});
        expect(attempts).toBe(2);
    },
);

test('API preserves the final HTTP error after exhausting retries', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
        attempts++;
        return new Response('{"error":"down"}', {status: 503});
    }) as unknown as typeof fetch;

    await expect(api.request('GET', '/unavailable-test')).rejects.toMatchObject({
        name: 'ApiRequestError',
        status: 503,
        data: {error: 'down'},
    });
    expect(attempts).toBe(3);
});

test('API does not retry malformed successful responses', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
        attempts++;
        return new Response('invalid json');
    }) as unknown as typeof fetch;

    await expect(api.request('GET', '/malformed-test')).rejects.toBeInstanceOf(SyntaxError);
    expect(attempts).toBe(1);
});
