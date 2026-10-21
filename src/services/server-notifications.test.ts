import {afterEach, expect, test} from 'bun:test';
import type {Client} from 'discord.js';

const {api, ApiRequestError} = await import('./api.ts');
const {config} = await import('../config.ts');
const {ServerNotificationService} = await import('./server-notifications.ts');
const original = {...api};
afterEach(() => {
    Object.assign(api, original);
    (config.discord as {devMode: boolean}).devMode = false;
    config.discord.devGuildIds.splice(0);
});

function fixture(guildId = 'guild-a') {
    const sent: Array<Record<string, unknown>> = [];
    const failures: Array<Parameters<typeof api.markServerNotificationFailed>> = [];
    let pending = [
        {
            id: 1,
            discord_server_id: 'guild-a',
            channel_id: 'channel-a',
            payload: {embeds: [{title: 'VN'}]},
            notification_type: 'update',
            delivery_mode: 'send' as const,
        },
    ];
    api.getPendingServerNotifications = async () => {
        const notifications = pending;
        pending = [];
        return {notifications, batch_key: 'claim-a', count: notifications.length};
    };
    api.markServerNotificationDelivered = async () => ({message: 'ok'});
    api.markServerNotificationFailed = async (...args) => {
        failures.push(args);
        return {message: 'ok'};
    };
    const channel = {
        guildId,
        isSendable: () => true,
        send: async (options: Record<string, unknown>) => {
            sent.push(options);
            return {id: 'message-a'};
        },
    };
    const client = {channels: {fetch: async () => channel}} as unknown as Client;
    return {sent, failures, client};
}

test('rejects a destination in another guild before sending', async () => {
    const {client, sent, failures} = fixture('guild-b');
    expect(await new ServerNotificationService(client).processServerNotifications()).toBe('error');
    expect(sent).toHaveLength(0);
    expect(failures[0]?.[3]).toBe(false);
});

test('empty development allowlist does not claim or send server notifications', async () => {
    const {client, sent} = fixture();
    (config.discord as {devMode: boolean}).devMode = true;
    api.getPendingServerNotifications = async () => {
        throw new Error('Must not claim suppressed work');
    };
    expect(await new ServerNotificationService(client).processServerNotifications()).toBe('ok');
    expect(sent).toHaveLength(0);
});

test('development claims include only allowlisted guilds and sender still checks them', async () => {
    const {client, sent, failures} = fixture();
    (config.discord as {devMode: boolean}).devMode = true;
    config.discord.devGuildIds.push('guild-b');
    const get = api.getPendingServerNotifications;
    let filter: readonly string[] | undefined;
    api.getPendingServerNotifications = async (limit, guildIds) => {
        filter = guildIds;
        return get(limit, guildIds);
    };
    expect(await new ServerNotificationService(client).processServerNotifications()).toBe('error');
    expect(filter).toEqual(['guild-b']);
    expect(sent).toHaveLength(0);
    expect(failures[0]?.[3]).toBe(true);
});

test('retries an acknowledgement on the next pass without repeating Discord delivery', async () => {
    const {client, sent, failures} = fixture();
    let acknowledgements = 0;
    api.markServerNotificationDelivered = async (_id, _batch, messageId) => {
        expect(messageId).toBe('message-a');
        if (++acknowledgements === 1) throw new ApiRequestError(503, 'unavailable');
        return {message: 'ok'};
    };
    const service = new ServerNotificationService(client);
    expect(await service.processServerNotifications()).toBe('error');
    expect(await service.processServerNotifications()).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({nonce: 'fvn-1', enforceNonce: true});
    expect(failures).toHaveLength(0);
});

test('permanent Discord failures are terminal and make the pass fail', async () => {
    const {client, failures} = fixture();
    let attempts = 0;
    client.channels.fetch = (async () => {
        attempts++;
        throw Object.assign(new Error('Missing permissions'), {code: 50013});
    }) as typeof client.channels.fetch;
    expect(await new ServerNotificationService(client).processServerNotifications()).toBe('error');
    expect(attempts).toBe(1);
    expect(failures[0]?.[3]).toBe(false);
});

test('temporary Discord failures are returned to the queue as retryable', async () => {
    const {client, failures} = fixture();
    client.channels.fetch = (async () => {
        throw new DOMException('Timed out', 'AbortError');
    }) as typeof client.channels.fetch;
    expect(await new ServerNotificationService(client).processServerNotifications()).toBe('error');
    expect(failures[0]?.[3]).toBe(true);
});
