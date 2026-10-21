import {afterEach, expect, test} from 'bun:test';
import type {ChatInputCommandInteraction, Client} from 'discord.js';

const {api} = await import('../services/api.ts');
const {config} = await import('../config.ts');
const {notificationsCommand} = await import('./notifications.ts');
const {searchCommand} = await import('./search.ts');
const originalVerify = api.verifyDm;
const originalSearch = api.search;

afterEach(() => {
    api.verifyDm = originalVerify;
    api.search = originalSearch;
    (config.discord as {devMode: boolean}).devMode = false;
});

const scenarios = [
    {name: 'delivered', reply: 'has marked', sends: 1, retryable: false},
    {name: 'unlinked', reply: 'could not save', sends: 1, retryable: false},
    {name: 'transient', reply: 'unchanged', sends: 1, retryable: true},
    {name: 'suppressed', reply: 'unchanged', sends: 0, retryable: true},
    {name: 'blocked', reply: 'could not deliver', sends: 1, retryable: false},
];

for (const scenario of scenarios) {
    test(`DM test reports ${scenario.name} delivery accurately`, async () => {
        let sends = 0;
        const replies: string[] = [];
        let verification: Parameters<typeof api.verifyDm> | undefined;
        (config.discord as {devMode: boolean}).devMode = scenario.name === 'suppressed';
        api.verifyDm = async (...args) => {
            verification = args;
            if (scenario.name === 'unlinked') throw new Error('Account not linked');
            return {success: true};
        };
        const client = {
            users: {
                fetch: async () => ({
                    createDM: async () => ({
                        send: async () => {
                            sends++;
                            if (scenario.name === 'transient') throw Object.assign(new Error('Temporary'), {status: 503});
                            if (scenario.name === 'blocked') throw Object.assign(new Error('Blocked'), {code: 50007});
                        },
                    }),
                }),
            },
        } as unknown as Client;

        await notificationsCommand.execute({
            options: {getSubcommand: () => 'test'},
            user: {id: 'unlisted'},
            client,
            deferReply: async () => {},
            editReply: async (reply: string) => {
                replies.push(reply);
            },
        } as unknown as ChatInputCommandInteraction);

        expect(replies[0]).toContain(scenario.reply);
        expect(replies[0]?.includes('has marked')).toBe(scenario.name === 'delivered');
        expect(sends).toBe(scenario.sends);
        expect(verification?.[3]).toBe(scenario.retryable);
    });
}

test('long no-result and error search replies fit Discord limits and cannot ping', async () => {
    for (const fail of [false, true]) {
        api.search = async () => {
            if (fail) throw new Error('Unavailable');
            return {matches: 0, games: []};
        };
        const replies: Array<{content: string; allowedMentions: {parse: string[]}}> = [];
        await searchCommand.execute({
            options: {getString: () => '@everyone'.repeat(400)},
            user: {username: 'test'},
            deferReply: async () => {},
            editReply: async (reply: (typeof replies)[number]) => {
                replies.push(reply);
            },
        } as unknown as ChatInputCommandInteraction);

        expect(replies[0]?.content.length).toBeLessThanOrEqual(2000);
        expect(replies[0]?.allowedMentions).toEqual({parse: []});
    }
});
