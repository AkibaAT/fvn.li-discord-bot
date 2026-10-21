import {expect, test} from 'bun:test';
import {X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {rootCertificates} from 'node:tls';

const recalled = new Set([
    '86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b',
    'd7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef4',
]);

test('Bun and the system trust store exclude both recalled roots', () => {
    const systemRoots =
        readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ??
        [];
    for (const roots of [rootCertificates, systemRoots]) {
        expect(roots.length).toBeGreaterThan(100);
        for (const pem of roots) {
            const fingerprint = new X509Certificate(pem).fingerprint256.replaceAll(':', '').toLowerCase();
            expect(recalled.has(fingerprint)).toBe(false);
        }
    }
});
