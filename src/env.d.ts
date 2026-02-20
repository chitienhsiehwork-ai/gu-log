import '../.astro/types.d.ts';

// External CDN module declarations
declare module 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs' {
  const mermaid: {
    initialize: (config: Record<string, unknown>) => void;
    run: (config: { nodes: Element[]; suppressErrors?: boolean }) => Promise<void>;
    render: (id: string, definition: string) => Promise<{ svg: string }>;
    [key: string]: unknown;
  };
  export default mermaid;
}
