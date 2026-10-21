import {config} from '../config.ts';

interface ApiResponse {
    [key: string]: unknown;
}

export class ApiRequestError extends Error {
    constructor(
        public readonly status: number,
        bodyPreview: string,
        public readonly data?: Record<string, unknown>,
    ) {
        super(`API request failed: ${status}, body: ${bodyPreview}`);
        this.name = 'ApiRequestError';
    }
}

const MAX_REQUEST_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
    if (error instanceof ApiRequestError) return error.status === 429 || error.status >= 500;
    return error instanceof TypeError || error instanceof DOMException;
}

async function sleepBeforeRetry(attempt: number): Promise<void> {
    const delay = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
    await Bun.sleep(delay);
}

export const api = {
    async request<T = ApiResponse>(method: 'GET' | 'POST', path: string, data?: Record<string, unknown> | null): Promise<T> {
        const url = `${config.laravel.apiUrl}/api${path}`;
        console.log(`[API] ${method} ${url}`);

        const body = data ? JSON.stringify(data) : undefined;
        for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
            let failure: unknown;
            try {
                const response = await fetch(url, {
                    method,
                    headers: {
                        Authorization: `Bearer ${config.laravel.apiToken}`,
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body,
                    signal: AbortSignal.timeout(config.polling.httpTimeoutMs),
                });

                const responseText = await response.text();
                const responsePreview = responseText.length > 100 ? responseText.slice(0, 100) + '...' : responseText;

                console.log(`[API] Response status: ${response.status}`);

                if (response.ok) return JSON.parse(responseText) as T;

                let errorData: Record<string, unknown> | undefined;
                try {
                    errorData = JSON.parse(responseText);
                } catch {
                    // Error pages can be plain text; keep the status for retry handling.
                }
                failure = new ApiRequestError(response.status, responsePreview, errorData);
            } catch (error) {
                failure = error;
            }

            if (attempt === MAX_REQUEST_ATTEMPTS || !isRetryable(failure)) throw failure;
            console.warn(`[API] Transient failure on attempt ${attempt}; retrying`, failure);
            await sleepBeforeRetry(attempt);
        }

        throw new Error('API retry loop exhausted');
    },

    async search(name: string): Promise<{
        matches: number;
        games: GameResult[];
        search_url?: string;
    }> {
        return this.request('POST', '/discord/search', {name});
    },

    async getChannelUpdates(): Promise<{
        notifications: ChannelUpdate[];
        batch_key: string;
    }> {
        return this.request('GET', '/discord-notifications/channel-updates', null);
    },

    async recordChannelStatus(
        batchKey: string,
        results: Array<{
            announcement_id: number;
            success: boolean;
            error: string;
        }>,
    ): Promise<{message: string}> {
        return this.request('POST', '/discord-notifications/channel-status', {
            batch_key: batchKey,
            results,
        });
    },

    async getPendingNotifications(): Promise<{
        notifications: Notification[];
        batch_key: string;
    }> {
        return this.request('GET', '/discord-notifications/pending', null);
    },

    async recordNotificationStatus(
        batchKey: string,
        notifications: Array<{
            notification_id: number;
            success: boolean;
            error: string;
            error_code: string | null;
            retryable: boolean;
        }>,
    ): Promise<{message: string}> {
        return this.request('POST', '/discord-notifications/status', {
            batch_key: batchKey,
            notifications,
        });
    },

    async getAdditionRequests(): Promise<{
        notifications: AdditionRequest[];
        admin_panel_url: string;
    }> {
        return this.request('GET', '/discord-notifications/addition-requests?limit=20');
    },

    async ackAdditionRequests(ids: number[], failures: AdminDeliveryFailure[] = []): Promise<{success: boolean}> {
        return this.request('POST', '/discord-notifications/addition-requests/ack', {ids, failures});
    },

    async getReviewReports(): Promise<{
        notifications: ReviewReport[];
    }> {
        return this.request('GET', '/discord-notifications/review-reports', null);
    },

    async ackReviewReports(ids: number[], failures: AdminDeliveryFailure[] = []): Promise<{success: boolean}> {
        return this.request('POST', '/discord-notifications/review-reports/ack', {ids, failures});
    },

    async verifyDm(discordUserId: string, success: boolean, errorCode: string | null, retryable = false): Promise<{success: boolean}> {
        return this.request('POST', '/discord-notifications/dm-verify', {
            discord_user_id: discordUserId,
            success,
            error_code: errorCode,
            retryable,
        });
    },

    async heartbeat(status: 'ok' | 'degraded' | 'error', passes: Record<string, string>): Promise<{success: boolean}> {
        return this.request('POST', '/discord-notifications/heartbeat', {status, passes});
    },

    async getPendingServerNotifications(
        limit = 50,
        guildIds?: readonly string[],
    ): Promise<{
        notifications: ServerNotification[];
        batch_key: string;
        count: number;
    }> {
        const params = new URLSearchParams({limit: String(limit)});
        guildIds?.forEach((id) => params.append('guild_ids[]', id));
        return this.request('GET', `/bot/servers/pending-notifications?${params}`, null);
    },

    async markServerNotificationDelivered(notificationId: number, batchKey: string, messageId?: string): Promise<{message: string}> {
        return this.request('POST', `/bot/servers/notifications/${notificationId}/delivered`, {batch_key: batchKey, message_id: messageId});
    },

    async markServerNotificationFailed(
        notificationId: number,
        batchKey: string,
        errorMessage?: string,
        retryable = false,
    ): Promise<{message: string}> {
        return this.request('POST', `/bot/servers/notifications/${notificationId}/failed`, {
            batch_key: batchKey,
            error_message: errorMessage,
            retryable,
        });
    },

    async syncChannels(
        discordServerId: string,
        channels: Array<{id: string; name: string; type?: number; nsfw?: boolean}>,
    ): Promise<{message: string; count: number}> {
        return this.request('POST', '/bot/servers/sync-channels', {
            discord_server_id: discordServerId,
            channels,
        });
    },

    async botJoined(
        discordServerId: string,
        serverName: string,
        channels?: Array<{id: string; name: string; type?: number; nsfw?: boolean}>,
        ownerDiscordId?: string,
    ): Promise<{message: string}> {
        return this.request('POST', '/bot/servers/bot-joined', {
            discord_server_id: discordServerId,
            discord_server_name: serverName,
            channels,
            owner_discord_id: ownerDiscordId,
        });
    },

    async reconcileGuilds(
        guilds: Array<{
            discord_server_id: string;
            discord_server_name: string;
            owner_discord_id?: string;
            channels: Array<{id: string; name: string; type?: number; nsfw?: boolean}>;
        }>,
    ): Promise<{message: string; count: number}> {
        return this.request('POST', '/bot/servers/reconcile-guilds', {guilds});
    },

    async botLeft(discordServerId: string): Promise<{message: string}> {
        return this.request('POST', `/bot/servers/${discordServerId}/bot-left`, null);
    },
};

export interface GameResult {
    name: string;
    version: string;
    english_word_count?: number;
    published_at: number;
    url: string | UrlMap;
    primary_url?: string;
}

export interface UrlMap {
    itch_io?: string;
    steam?: string;
    other?: string;
}

export interface Update {
    name: string;
    version: string;
    published_at: string | number;
    url: string | UrlMap;
    devlog?: string;
}

export interface ChannelUpdate extends Update {
    announcement_id: number;
}

export interface Notification {
    notification_id: number;
    discord_user_id: string;
    type: 'game_update' | 'test';
    game: {
        name: string;
        version: string;
        published_at: number;
        url: string | UrlMap;
        devlog_url?: string;
        word_count_diff?: number;
        compared_to_version?: {
            version: string;
            is_last_read: boolean;
        };
    } | null;
    is_digest: boolean;
    digest_type?: string;
}

export interface AdditionRequest {
    id: number;
    claim_token?: string;
    url: string;
    user_count: number;
    users: Array<{name: string}>;
}

export interface AdminDeliveryFailure {
    id: number;
    retryable: boolean;
    claim_token?: string;
}

export interface ReviewReport {
    id: number;
    claim_token?: string;
    reason: string;
    reporter: string;
    review_author: string;
    game_name: string;
    details: string;
    review_excerpt: string;
    admin_panel_url: string;
}

export interface ServerNotification {
    id: number;
    discord_server_id: string;
    channel_id: string;
    payload: {
        content?: string;
        embeds?: Array<Record<string, unknown>>;
    } | null;
    game_name?: string;
    notification_type: string;
    delivery_mode: 'send' | 'edit';
    message_id?: string | null;
}

export function extractUrl(url: string | UrlMap | undefined | null): string {
    if (!url) return '';
    if (typeof url === 'string') return url;
    if (url.itch_io) return url.itch_io;
    if (url.steam) return url.steam;
    if (url.other) return url.other;
    return '';
}
