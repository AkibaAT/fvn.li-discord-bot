import {expect, test} from 'bun:test';

for (const scenario of ['commands', 'reconcile']) {
    test(`continues polling and recovers after a ${scenario} failure`, async () => {
        const child = Bun.spawn([process.execPath, `${import.meta.dir}/startup-fixture.ts`, scenario], {stdout: 'pipe', stderr: 'pipe'});
        const [output, error, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ]);
        expect({code, output: output.includes('Startup recovery passed:'), error: code === 0 ? '' : error}).toEqual({
            code: 0,
            output: true,
            error: '',
        });
    });
}
