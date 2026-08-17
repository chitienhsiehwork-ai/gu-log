import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FETCHER = path.join(ROOT, 'scripts', 'fetch-article.py');

function extract(html: string, title = ''): string {
  const program = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("fetch_article", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.soup_to_text(sys.stdin.read(), sys.argv[2]))',
  ].join('; ');
  const result = spawnSync('python3', ['-c', program, FETCHER, title], {
    cwd: ROOT,
    encoding: 'utf8',
    input: html,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `fetch-article.py exited ${result.status}`);
  }
  return result.stdout.trim();
}

function publicationDate(html: string): string {
  const program = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("fetch_article", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.extract_publication_date(sys.stdin.read()))',
  ].join('; ');
  const result = spawnSync('python3', ['-c', program, FETCHER], {
    cwd: ROOT,
    encoding: 'utf8',
    input: html,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `fetch-article.py exited ${result.status}`);
  }
  return result.stdout.trim();
}

describe('fetch-article HTML projection', () => {
  it('preserves links and media without duplicating nested quote blocks', () => {
    const output = extract(
      `
        <article>
          <h1>Example article</h1>
          <p>Read the <a href="https://example.com/source">reasoning trace</a>.</p>
          <blockquote>
            <p>The prompt starts here.</p>
            <pre>[{"bbox_2d": [1, 2, 3, 4], "label": "pelican"}]</pre>
            <p><code>Build an HTML page from the JSON above.</code></p>
          </blockquote>
          <p><img src="https://example.com/pelican.jpg" alt='A pelican {"label": "pelican"} on a bicycle'></p>
          <p><video controls><source src="https://example.com/demo.mp4">Video fallback.</video></p>
          Loose article sentence.
        </article>
      `,
      'Example article'
    );

    expect(output.match(/Example article/g)).toHaveLength(1);
    expect(output).toContain('[reasoning trace](https://example.com/source)');
    expect(output.match(/The prompt starts here\./g)).toHaveLength(1);
    expect(output.match(/"bbox_2d"/g)).toHaveLength(1);
    expect(output).toContain('> ```\n> [{"bbox_2d": [1, 2, 3, 4], "label": "pelican"}]\n> ```');
    expect(output.match(/Build an HTML page from the JSON above\./g)).toHaveLength(1);
    expect(output).toContain(
      '![A pelican \\{"label": "pelican"\\} on a bicycle](https://example.com/pelican.jpg)'
    );
    expect(output).toContain('[Video](https://example.com/demo.mp4)');
    expect(output).toContain('Loose article sentence.');
  });

  it('extracts a durable publication date instead of substituting the fetch date', () => {
    expect(
      publicationDate('<meta property="article:published_time" content="2026-08-16T22:00:00Z">')
    ).toBe('2026-08-16');
    expect(publicationDate('<p class="mobile-date">16th August 2026</p>')).toBe('2026-08-16');
  });
});
