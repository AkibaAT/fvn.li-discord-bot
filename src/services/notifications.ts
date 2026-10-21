import type {Client, GuildTextBasedChannel} from 'discord.js';
import {config} from '../config.ts';
import {api, extractUrl, type ChannelUpdate, type Update} from './api.ts';
import {DeliveryPolicy} from './delivery-policy.ts';
import {classifyDiscordError, type DiscordErrorClassification} from './discord-errors.ts';
import {splitMessage} from './message-content.ts';

const NO_MENTIONS = {parse: []} as const;
const MESSAGE_LIMIT = 1900;

export interface DeliveryResult {
    success: boolean;
    error: string;
    errorCode: string | null;
    retryable: boolean;
}

interface UpdateChunk {
    content: string;
    announcementIds: number[];
}

const success = (): DeliveryResult => ({success: true, error: '', errorCode: null, retryable: false});

export class NotificationService {
    private readonly client: Client;
    private readonly deliveryPolicy: DeliveryPolicy;

    constructor(client: Client) {
        this.client = client;
        this.deliveryPolicy = new DeliveryPolicy({
            devMode: config.discord.devMode,
            devUserIds: config.discord.devUserIds,
            devGuildIds: config.discord.devGuildIds,
        });
    }

    async processUpdates(): Promise<'ok' | 'error'> {
        console.log('\n[processUpdates] Start');
        if (!config.discord.adminId && !config.discord.adminNotificationsChannelId) return 'ok';

        try {
            const response = await api.getChannelUpdates();
            if (!response.notifications?.length) return 'ok';

            const results: Array<{announcement_id: number; success: boolean; error: string}> = [];
            for (const chunk of this.buildUpdateMessages(response.notifications)) {
                const outcome = await this.announceUpdateChunk(chunk.content);
                for (const announcementId of chunk.announcementIds) {
                    results.push({announcement_id: announcementId, success: outcome.success, error: outcome.error});
                }
            }

            await api.recordChannelStatus(response.batch_key, results);
            return results.every((result) => result.success) ? 'ok' : 'error';
        } catch (error) {
            console.error('[processUpdates] Error:', error);
            return 'error';
        }
    }

    private async announceUpdateChunk(content: string): Promise<DeliveryResult> {
        if (config.discord.adminId) {
            const adminOutcome = await this.sendAdminUpdate(content);
            if (!adminOutcome.success) return adminOutcome;

            if (config.discord.adminNotificationsChannelId) {
                const mirror = await this.sendChannelUpdate(content);
                if (!mirror.success) console.error('[processUpdates] Channel mirror failed:', mirror.error);
            }
            return success();
        }

        return this.sendChannelUpdate(content);
    }

    private async sendAdminUpdate(content: string): Promise<DeliveryResult> {
        if (!this.deliveryPolicy.allowsUser(config.discord.adminId)) {
            return this.suppressed('admin user', config.discord.adminId);
        }
        return this.sendDM(config.discord.adminId, content);
    }

    private async sendChannelUpdate(content: string): Promise<DeliveryResult> {
        try {
            const channel = (await this.client.channels.fetch(config.discord.adminNotificationsChannelId)) as GuildTextBasedChannel | null;
            if (!channel) return this.failure(new Error('Notifications channel not found'));
            if (!this.deliveryPolicy.allowsGuild(channel.guildId)) return this.suppressed('guild', channel.guildId);

            await channel.send({content, allowedMentions: NO_MENTIONS});
            return success();
        } catch (error) {
            return this.failure(error);
        }
    }

    async processUserNotifications(): Promise<'ok' | 'error'> {
        console.log('\n[processUserNotifications] Start');
        try {
            const response = await api.getPendingNotifications();
            if (!response.notifications?.length) return 'ok';

            const results: Array<{
                notification_id: number;
                success: boolean;
                error: string;
                error_code: string | null;
                retryable: boolean;
            }> = [];

            for (const notification of response.notifications) {
                let outcome: DeliveryResult;
                if (!this.deliveryPolicy.allowsUser(notification.discord_user_id)) {
                    outcome = this.suppressed('user', notification.discord_user_id);
                } else {
                    const message =
                        notification.type === 'test' || !notification.game
                            ? 'FVN.li notification test\n\nIf you received this message, Discord direct-message delivery is working.'
                            : this.gameUpdateMessage(notification.game, notification.is_digest, notification.digest_type);
                    outcome = await this.sendDM(notification.discord_user_id, message);
                }

                results.push({
                    notification_id: notification.notification_id,
                    success: outcome.success,
                    error: outcome.error,
                    error_code: outcome.errorCode,
                    retryable: outcome.retryable,
                });
            }

            await api.recordNotificationStatus(response.batch_key, results);
            return results.every((result) => result.success) ? 'ok' : 'error';
        } catch (error) {
            console.error('[processUserNotifications] Error:', error);
            return 'error';
        }
    }

    async processAdditionRequestNotifications(): Promise<'ok' | 'error'> {
        console.log('\n[processAdditionRequestNotifications] Start');
        if (!config.discord.adminId || !this.deliveryPolicy.allowsUser(config.discord.adminId)) return 'ok';

        try {
            const response = await api.getAdditionRequests();
            if (!response.notifications?.length) return 'ok';
            let acknowledged = 0;
            let failed = false;
            for (const notification of response.notifications) {
                const users = notification.users.map((user) => user.name).join(', ');
                const suffix = notification.user_count === 1 ? '' : 's';
                const message = `🎮 **New VN Addition Request**\n\n**URL:** ${notification.url}\n**Requested by:** ${users} (${notification.user_count} user${suffix})\n**Admin Panel:** <${response.admin_panel_url}>`;
                const outcome = await this.sendDM(config.discord.adminId, message);
                try {
                    if (outcome.success) {
                        await api.ackAdditionRequests([notification.id]);
                        acknowledged++;
                    } else {
                        failed = true;
                        await api.ackAdditionRequests(
                            [],
                            [{id: notification.id, retryable: outcome.retryable, claim_token: notification.claim_token}],
                        );
                    }
                } catch (error) {
                    failed = true;
                    console.error('[admin alert] Could not report delivery:', error);
                }
            }
            console.log(`[processAdditionRequestNotifications] Acknowledged ${acknowledged} request(s)`);
            return failed ? 'error' : 'ok';
        } catch (error) {
            console.error('[processAdditionRequestNotifications] Error:', error);
            return 'error';
        }
    }

    async processReviewReportNotifications(): Promise<'ok' | 'error'> {
        console.log('\n[processReviewReportNotifications] Start');
        if (!config.discord.adminId || !this.deliveryPolicy.allowsUser(config.discord.adminId)) return 'ok';

        try {
            const response = await api.getReviewReports();
            if (!response.notifications?.length) return 'ok';
            let failed = false;
            for (const notification of response.notifications) {
                let message = `🚩 **Review Report**\n\n**Game:** ${notification.game_name}\n**Review by:** ${notification.review_author}\n**Reported by:** ${notification.reporter}\n**Reason:** ${notification.reason}`;
                if (notification.details) message += `\n**Details:** ${notification.details}`;
                if (notification.review_excerpt) message += `\n\n> ${notification.review_excerpt.slice(0, 200)}`;
                message += `\n\n**Admin Panel:** <${notification.admin_panel_url}>`;

                const outcome = await this.sendDM(config.discord.adminId, message);
                try {
                    if (outcome.success) await api.ackReviewReports([notification.id]);
                    else {
                        failed = true;
                        await api.ackReviewReports(
                            [],
                            [{id: notification.id, retryable: outcome.retryable, claim_token: notification.claim_token}],
                        );
                    }
                } catch (error) {
                    failed = true;
                    console.error('[admin alert] Could not report delivery:', error);
                }
            }
            return failed ? 'error' : 'ok';
        } catch (error) {
            console.error('[processReviewReportNotifications] Error:', error);
            return 'error';
        }
    }

    async testDm(userId: string): Promise<DeliveryResult> {
        if (!this.deliveryPolicy.allowsUser(userId)) return this.suppressed('user', userId);
        return this.sendDM(userId, 'FVN.li notification test\n\nDiscord direct-message delivery is working.');
    }

    buildUpdateMessages(updates: ChannelUpdate[]): UpdateChunk[] {
        const chunks: UpdateChunk[] = [];
        let content = `Found ${updates.length} new updates:\n`;
        let announcementIds: number[] = [];

        for (const update of updates) {
            let entry = this.updateEntry(update);

            if (content.length + entry.length > MESSAGE_LIMIT && announcementIds.length > 0) {
                chunks.push({content, announcementIds});
                content = '';
                announcementIds = [];
            }
            if (content.length + entry.length > MESSAGE_LIMIT) {
                const available = MESSAGE_LIMIT - content.length;
                entry = `${entry.slice(0, Math.max(0, available - 2))}…\n`;
            }
            content += entry;
            announcementIds.push(update.announcement_id);
        }

        if (announcementIds.length > 0) chunks.push({content, announcementIds});
        return chunks;
    }

    private updateEntry(update: Update): string {
        const publishedAt = typeof update.published_at === 'number' ? Math.floor(update.published_at).toString() : update.published_at;
        return `${update.name}, Latest Version: ${update.version}, Last Updated At: <t:${publishedAt}:f> <${extractUrl(update.url)}> | <${update.devlog ?? ''}>\n`;
    }

    private gameUpdateMessage(game: NonNullable<import('./api.ts').Notification['game']>, isDigest: boolean, digestType?: string): string {
        const gameUrl = extractUrl(game.url);
        const devlogUrl = game.devlog_url ?? '';
        let wordCount = '';
        if (game.word_count_diff) {
            const compared = game.compared_to_version;
            const compareType = compared?.is_last_read ? 'your last read' : 'previous version';
            wordCount = `\nWord count change from ${compareType} (${compared?.version}): ${game.word_count_diff > 0 ? '+' : ''}${game.word_count_diff.toLocaleString()} words`;
        }
        let heading = 'Game Updates';
        if (!isDigest) heading = 'New Update Available!';
        else if (digestType === 'daily') heading = 'Daily Game Updates';
        else if (digestType === 'weekly') heading = 'Weekly Game Updates';
        return `${heading}\n\n${game.name}\nVersion: ${game.version}\nReleased: <t:${Math.floor(game.published_at)}:f>${wordCount}\nGame: <${gameUrl}>\nDevlog: <${devlogUrl}>`;
    }

    private async sendDM(userId: string, message: string): Promise<DeliveryResult> {
        try {
            const user = await this.client.users.fetch(userId);
            const channel = await user.createDM();
            for (const content of splitMessage(message)) {
                await channel.send({content, allowedMentions: NO_MENTIONS});
            }
            return success();
        } catch (error) {
            console.error(`[sendDM] Error for ${userId}:`, error);
            return this.failure(error);
        }
    }

    private failure(error: unknown): DeliveryResult {
        const classified: DiscordErrorClassification = classifyDiscordError(error);
        return {
            success: false,
            error: classified.message.slice(0, 1000),
            errorCode: classified.code,
            retryable: classified.category === 'retryable',
        };
    }

    private suppressed(target: string, id: string): DeliveryResult {
        const error = `dev_mode_suppressed:${target}:${id}`;
        console.log(`[delivery] ${error}`);
        return {success: false, error, errorCode: 'dev_mode_suppressed', retryable: true};
    }
}
