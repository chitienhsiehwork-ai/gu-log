import { execFile, type ExecFileException } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

const CHECK_LINKS_URL = new URL('../scripts/check-links.mjs', import.meta.url).href;

describe('broken-link external request lifecycle', () => {
  it('cancels a stalled GET response body after the HEAD fallback', async () => {
    const server = createServer((request, response) => {
      if (request.method === 'HEAD') {
        response.writeHead(405);
        response.end();
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('partial body');
    });

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}/stalled`;
      const childScript = `
        import { scanExternalLinks } from ${JSON.stringify(CHECK_LINKS_URL)};
        const url = process.argv[1];
        const result = await scanExternalLinks([
          { url, file: 'fixture.mdx', context: 'stalled GET fixture' },
        ]);
        process.stdout.write(JSON.stringify(result));
      `;

      const { error, stdout, stderr } = await new Promise<{
        error: ExecFileException | null;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        execFile(
          process.execPath,
          ['--input-type=module', '--eval', childScript, url],
          { encoding: 'utf8', killSignal: 'SIGKILL', timeout: 2_500 },
          (error, stdout, stderr) => resolve({ error, stdout, stderr })
        );
      });

      expect(error, stderr).toBeNull();
      expect(JSON.parse(stdout).health).toMatchObject({
        attempted: 1,
        ok: 1,
        broken: [],
        timedOut: 0,
      });
    } finally {
      server.closeAllConnections();
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  }, 10_000);
});
