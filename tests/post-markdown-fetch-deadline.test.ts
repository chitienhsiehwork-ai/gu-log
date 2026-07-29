import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const openServers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
  openServers.clear();
});

describe('post Markdown deployment fetch deadline', () => {
  it('keeps the deadline active while a response body stalls', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('partial');
    });
    openServers.add(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const verifier = await import('../scripts/verify-post-markdown-deployment.mjs');
    const fetchWithDeadline = Reflect.get(verifier, 'fetchWithDeadline');

    expect(fetchWithDeadline).toEqual(expect.any(Function));
    const response = await fetchWithDeadline(`http://127.0.0.1:${port}/stalled`, {}, 50);

    await expect(response.text()).rejects.toMatchObject({ name: 'TimeoutError' });
  }, 2_000);
});
