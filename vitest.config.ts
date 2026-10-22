import { getViteConfig } from 'astro/config';

export default getViteConfig({
  resolve: {
    // Astro 的 getViteConfig 預設開 Vite 原生 tsconfigPaths。它找 tsconfig 時會往上層目錄走，
    // 在 `.claude/worktrees/<name>/` 這種巢狀 worktree 裡會讀到主 checkout 的 tsconfig.json；
    // 主 checkout 沒裝 node_modules 時 `extends: astro/tsconfigs/strict` 解析失敗，
    // 整個 suite 炸 "Tsconfig not found"。gu-log 沒有用 tsconfig `paths` alias，測試關掉不影響解析。
    tsconfigPaths: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Exclude playwright e2e tests (they use .spec.ts)
    exclude: ['tests/**/*.spec.ts', 'tests/**/pseudo/**', 'node_modules'],
    // git 2.47 起，commit 後的 auto maintenance 預設在背景跑，會在 .git/objects 建 lock 檔；
    // 測試剛好在這時刪暫存 repo 就會 ENOTEMPTY。測試用不到 maintenance，一律關掉。
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'maintenance.auto',
      GIT_CONFIG_VALUE_0: 'false',
    },
  },
});
