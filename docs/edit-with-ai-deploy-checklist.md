# Edit with AI Deploy Checklist

最後更新：2026-03-08

目的：把 `Edit with AI` 前端修正部署到 Vercel 前，先把已知風險和必要檢查收斂成一張清單。

## Topology

- Frontend: `gu-log` on Vercel
- Production URL: `https://gu-log.vercel.app`
- API backend: `gu-log-api` on VM `clawd@46.225.20.205`
- Public API URL: `https://api.shroomdog.dev`
- Tunnel: `cloudflared-gu-log.service`
- Backend service: `gu-log-api.service`

## Verified Already

- [x] VM backend service is up: `gu-log-api.service`
- [x] Cloudflare tunnel is up: `cloudflared-gu-log.service`
- [x] Local backend health check returns `200`: `http://127.0.0.1:8787/health`
- [x] Public backend health check returns `200`: `https://api.shroomdog.dev/health`
- [x] Frontend fallback API URL points to `https://api.shroomdog.dev`
- [x] Playwright local regression passed across all configured projects: `66 passed`
- [x] Playwright `Mobile Safari` local subset passed with expanded coverage: `23 passed`
- [x] Live production smoke on `https://gu-log.vercel.app` passed for mobile popup/auth basics
- [x] Vercel project is linked to GitHub repo `chitienhsiehwork-ai/gu-log`
- [x] Vercel production branch is `main`

## Still Needed Before Deploy

- [ ] Add Vercel project env var: `PUBLIC_API_URL=https://api.shroomdog.dev`
- [ ] Commit current `Edit with AI` frontend + test changes
- [ ] Push branch and create a Vercel preview deployment
- [ ] Run `Mobile Safari` Playwright smoke against the preview URL
- [ ] Confirm preview uses the new `AiPopup` code, not current production
- [ ] Decide whether to promote preview to production

## Optional But Strongly Recommended

- [ ] Run one real authenticated `Edit with AI` flow against preview/prod with actual GitHub OAuth + actual backend response
- [ ] Record the deploy result in runbook / memory so docs do not drift again
- [ ] Add `PUBLIC_API_URL` to Vercel env instead of relying on source fallback forever

## Deploy Commands / Checks

### 1. Pre-push local checks

```bash
./node_modules/.bin/playwright test tests/ai-popup.spec.ts tests/ai-popup-extended.spec.ts tests/ai-popup-chatbox.spec.ts
./node_modules/.bin/playwright test tests/ai-popup.spec.ts tests/ai-popup-extended.spec.ts tests/ai-popup-chatbox.spec.ts --project="Mobile Safari"
```

### 2. After preview deploy

Set:

```bash
export PLAYWRIGHT_BASE_URL="https://<preview-url>"
```

Then run:

```bash
./node_modules/.bin/playwright test tests/ai-popup.spec.ts --project="Mobile Safari" --grep "bottom sheet|shows login button|Auth Callback|return URL"
./node_modules/.bin/playwright test tests/ai-popup-chatbox.spec.ts tests/ai-popup-extended.spec.ts tests/ai-popup.spec.ts --project="Mobile Safari"
```

### 3. Production sanity check

```bash
curl -i https://gu-log.vercel.app
curl -i https://api.shroomdog.dev/health
```

## Known Current Risk

- Current production `gu-log.vercel.app` has not received the local `Edit with AI` fixes yet.
- Current Vercel project env list is empty, so production behavior relies on source fallback for `PUBLIC_API_URL`.
- Full real-world E2E with actual GitHub login + actual AI edit/confirm is not yet re-verified on a freshly deployed preview of this patch set.
