const MESSAGE_LIMIT = 2000;

export function truncateMessage(content: string): string {
    if (content.length <= MESSAGE_LIMIT) return content;
    let end = MESSAGE_LIMIT - 1;
    if (/[\uD800-\uDBFF]/.test(content[end - 1] ?? '')) end--;
    return content.slice(0, end) + '…';
}

export function splitMessage(content: string): string[] {
    const chunks: string[] = [];
    while (content.length > MESSAGE_LIMIT) {
        let end = content.lastIndexOf('\n', MESSAGE_LIMIT);
        if (end < 1) end = content.lastIndexOf(' ', MESSAGE_LIMIT);
        if (end < 1) end = MESSAGE_LIMIT;
        if (/[\uD800-\uDBFF]/.test(content[end - 1] ?? '')) end--;
        chunks.push(content.slice(0, end));
        content = content.slice(end).trimStart();
    }
    if (content) chunks.push(content);
    return chunks;
}
