import {expect, test} from 'bun:test';
import {splitMessage, truncateMessage} from './message-content.ts';

test('long messages preserve every word and link across valid Discord chunks', () => {
    const words = Array.from({length: 600}, (_, i) => `requester-${i}`);
    const message = words.join(' ') + '\nhttps://example.test/admin';
    const chunks = splitMessage(message);
    expect(chunks.every((chunk) => chunk.length <= 2000 && chunk.length > 0)).toBe(true);
    expect(chunks.join(' ').split(/\s+/)).toEqual([...words, 'https://example.test/admin']);
});

test('bounded messages do not split a surrogate pair at the Discord limit', () => {
    const message = 'a'.repeat(1998) + '🐾'.repeat(4);
    expect(truncateMessage(message).length).toBeLessThanOrEqual(2000);
    expect(truncateMessage(message)).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(splitMessage(message).join('')).toBe(message);
});
