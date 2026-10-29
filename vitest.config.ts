import { getViteConfig } from 'astro/config';

// Exclude playwright e2e tests (they use .spec.ts)
const EXCLUDE = ['tests/**/*.spec.ts', 'tests/**/pseudo/**', 'node_modules'];
// tribunal 的 runner-error-guard 會在 posts/ 裡暫時改寫、甚至刪掉真文章（en-sd-1）再還原。
// 跟其他讀整個語料的測試平行跑，對方就會撞到 ENOENT 或快照對不上，所以這支單獨排在
// 其他測試全部跑完之後（groupOrder 大的組晚跑）。
const POSTS_MUTATING = ['tests/tribunal-shell-safety-contract.test.ts'];

export default getViteConfig({
  resolve: {
    // Astro 的 getViteConfig 預設開 Vite 原生 tsconfigPaths。它找 tsconfig 時會往上層目錄走，
    // 在 `.claude/worktrees/<name>/` 這種巢狀 worktree 裡會讀到主 checkout 的 tsconfig.json；
    // 主 checkout 沒裝 node_modules 時 `extends: astro/tsconfigs/strict` 解析失敗，
    // 整個 suite 炸 "Tsconfig not found"。gu-log 沒有用 tsconfig `paths` alias，測試關掉不影響解析。
    tsconfigPaths: false,
  },
  test: {
    // git 2.47 起，commit 後的 auto maintenance 預設在背景跑，會在 .git/objects 建 lock 檔；
    // 測試剛好在這時刪暫存 repo 就會 ENOTEMPTY。測試用不到 maintenance，一律關掉。
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'maintenance.auto',
      GIT_CONFIG_VALUE_0: 'false',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: [...EXCLUDE, ...POSTS_MUTATING],
        },
      },
      {
        extends: true,
        test: {
          name: 'posts-mutating',
          include: POSTS_MUTATING,
          exclude: EXCLUDE,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
