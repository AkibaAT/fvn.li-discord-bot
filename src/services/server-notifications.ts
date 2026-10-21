import {truncateMessage} from './message-content.ts';
import type {APIEmbed, Client, MessageCreateOptions} from 'discord.js';
import {config} from '../config.ts';
import {api, ApiRequestError, type ServerNotification} from './api.ts';
import {DeliveryPolicy} from './delivery-policy.ts';
import {classifyDiscordError} from './discord-errors.ts';

export class ServerNotificationService {
    private readonly policy = new DeliveryPolicy(config.discord);
    // shortcut: receipts are lost on restart; persist them if restarts must not cause duplicates.
    private readonly receipts = new Map<number, {batchKey: string; messageId: string}>();

    constructor(private readonly client: Client) {}

    async processServerNotifications(): Promise<'ok' | 'error'> {
        if (config.discord.devMode && config.discord.devGuildIds.length === 0) return 'ok';
        let failed = false;
        for (const [id, receipt] of this.receipts) {
            if (!(await this.acknowledge(id, receipt))) failed = true;
        }

        try {
            const response = await api.getPendingServerNotifications(50, config.discord.devMode ? config.discord.devGuildIds : undefined);
            for (const notification of response.notifications ?? []) {
                const receipt = this.receipts.get(notification.id);
                if (receipt) {
                    receipt.batchKey = response.batch_key;
                    if (!(await this.acknowledge(notification.id, receipt))) failed = true;
                    continue;
                }

                let messageId: string;
                try {
                    messageId = await this.deliver(notification);
                } catch (error) {
                    failed = true;
                    const outcome = classifyDiscordError(error);
                    try {
                        await api.markServerNotificationFailed(
                            notification.id,
                            response.batch_key,
                            outcome.message.slice(0, 500),
                            outcome.category === 'retryable',
                        );
                    } catch (statusError) {
                        console.error('[server delivery] Failed to report failure:', statusError);
                    }
                    continue;
                }

                const delivered = {batchKey: response.batch_key, messageId};
                this.receipts.set(notification.id, delivered);
                if (!(await this.acknowledge(notification.id, delivered))) failed = true;
            }
        } catch (error) {
            console.error('[server delivery] Poll failed:', error);
            return 'error';
        }
        return failed ? 'error' : 'ok';
    }

    private async acknowledge(id: number, receipt: {batchKey: string; messageId: string}): Promise<boolean> {
        try {
            await api.markServerNotificationDelivered(id, receipt.batchKey, receipt.messageId);
            this.receipts.delete(id);
            return true;
        } catch (error) {
            if (
                error instanceof ApiRequestError &&
                error.status === 409 &&
                ['sent', 'failed'].includes(String(error.data?.notification_status))
            ) {
                this.receipts.delete(id);
            }
            console.error(`[server delivery] Receipt for #${id} was not acknowledged:`, error);
            return false;
        }
    }

    private async deliver(notification: ServerNotification): Promise<string> {
        if (!this.policy.allowsGuild(notification.discord_server_id)) {
            throw Object.assign(new Error('dev_mode_suppressed'), {code: 'dev_mode_suppressed'});
        }
        const channel = await this.client.channels.fetch(notification.channel_id);
        if (!channel || !channel.isSendable() || !('guildId' in channel) || channel.guildId !== notification.discord_server_id) {
            throw new Error('The destination is not a sendable channel in the configured server.');
        }

        const payload = notification.payload ?? {};
        const options: MessageCreateOptions = {};
        if (payload.content) options.content = payload.content;
        if (payload.embeds?.length) options.embeds = payload.embeds as APIEmbed[];
        if (!options.content && !options.embeds) {
            options.content = notification.game_name
                ? `**${notification.game_name}** - ${notification.notification_type}`
                : `Notification: ${notification.notification_type}`;
        }

        if (options.content) options.content = truncateMessage(options.content);

        if (notification.delivery_mode === 'edit' && notification.message_id) {
            try {
                const message = await channel.messages.fetch(notification.message_id);
                return (await message.edit({content: options.content ?? null, embeds: options.embeds ?? []})).id;
            } catch (error) {
                if (String((error as {code?: unknown})?.code) !== '10008') throw error;
            }
        }
        return (await channel.send({...options, nonce: `fvn-${notification.id}`, enforceNonce: true})).id;
    }
}
