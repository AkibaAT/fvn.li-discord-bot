import {resolve} from 'node:path';
import {mock} from 'bun:test';
import {strict as assert} from 'node:assert';
import {setImmediate} from 'node:timers/promises';

const root = resolve(import.meta.dir, '../src');
const scenario = process.argv[2];
let ready: () => void;
let poll: () => void;
let reconciles = 0;
let servers = 0;
let updatePolls = 0;
let registrations = 0;
let guildListeners = 0;
class ApiRequestError extends Error {
    status = 503;
}
class Client {
    once(_event: string, callback: typeof ready) {
        ready = callback;
    }
    on() {}
    async login() {}
}
mock.module(Bun.resolveSync('discord.js', root), () => ({
    Client,
    Events: {ClientReady: 'ready', Error: 'error', Warn: 'warn'},
    IntentsBitField: {Flags: {Guilds: 1}},
}));
mock.module(`${root}/config.ts`, () => ({config: {discord: {token: 'dummy'}, polling: {intervalMs: 60000}}}));
mock.module(`${root}/events/handlers.ts`, () => ({
    registerEvents() {},
    async registerCommands() {
        registrations++;
        if (scenario === 'commands' && registrations === 1) throw new Error('registration unavailable');
    },
}));
mock.module(`${root}/events/guilds.ts`, () => ({
    async reconcileCurrentGuilds() {
        reconciles++;
        if (scenario === 'reconcile' && reconciles === 1) throw new ApiRequestError();
    },
    registerGuildEvents() {
        guildListeners++;
    },
}));
mock.module(`${root}/services/api.ts`, () => ({api: {async heartbeat() {}}, ApiRequestError}));
mock.module(`${root}/services/notifications.ts`, () => ({
    NotificationService: class {
        async processUpdates() {
            updatePolls++;
            return 'ok';
        }
        async processUserNotifications() {
            return 'ok';
        }
        async processAdditionRequestNotifications() {
            return 'ok';
        }
        async processReviewReportNotifications() {
            return 'ok';
        }
    },
}));
mock.module(`${root}/services/server-notifications.ts`, () => ({
    ServerNotificationService: class {
        async processServerNotifications() {
            servers++;
            return 'ok';
        }
    },
}));
globalThis.fetch = (() => {
    throw new Error('Unexpected network request in startup test');
}) as typeof fetch;
globalThis.setTimeout = ((callback: () => void) => {
    poll = callback;
    return 0;
}) as unknown as typeof setTimeout;
await import(`${root}/index.ts`);
ready!();
for (let i = 0; i < 3; i++) {
    poll!();
    await setImmediate();
}
assert.equal(updatePolls, 3);
assert.equal(registrations, scenario === 'commands' ? 2 : 1);
assert.equal(reconciles, scenario === 'reconcile' ? 2 : 1);
assert.equal(servers, scenario === 'reconcile' ? 2 : 3);
assert.equal(guildListeners, 1);
console.log('Startup recovery passed:', scenario);
