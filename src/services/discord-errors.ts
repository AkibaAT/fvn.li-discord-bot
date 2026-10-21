export type DiscordErrorCategory = 'undeliverable' | 'retryable' | 'permanent';

export interface DiscordErrorClassification {
    code: string | null;
    category: DiscordErrorCategory;
    message: string;
}

const UNDELIVERABLE_CODES = new Set(['50007', '50278', '10013']);
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);

export function classifyDiscordError(error: unknown): DiscordErrorClassification {
    const candidate = error as {
        name?: string;
        code?: string | number;
        status?: number;
        message?: string;
        rawError?: {code?: string | number; message?: string};
    };
    const rawCode = candidate?.code ?? candidate?.rawError?.code ?? candidate?.status;
    const code = rawCode === undefined || rawCode === null ? null : String(rawCode);
    const message = candidate?.message ?? candidate?.rawError?.message ?? String(error);

    if (code && UNDELIVERABLE_CODES.has(code)) return {code, category: 'undeliverable', message};
    if (
        candidate?.name === 'AbortError' ||
        candidate?.name === 'TimeoutError' ||
        code === 'dev_mode_suppressed' ||
        (candidate?.status && (candidate.status === 429 || candidate.status >= 500)) ||
        (code && RETRYABLE_CODES.has(code))
    ) {
        return {code, category: 'retryable', message};
    }

    return {code, category: 'permanent', message};
}
