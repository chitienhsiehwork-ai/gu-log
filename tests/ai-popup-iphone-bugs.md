# AI Popup iPhone Bug Report & E2E Testing Doc

## Testing Methodology

### Tools Used
- **Playwright** with `devices['iPhone 14']` emulation (390x664, DPR 3, touch)
- **Chromium engine** (WebKit unavailable on Linux VPS — missing system deps)
- Custom exploration scripts to probe specific behaviors
- Production site available at https://gu-log.vercel.app, local dev at localhost:4321

### How Bugs Were Found
1. Ran existing `ai-popup.spec.ts` → all 6 Mobile Chrome tests pass (Pixel 5)
2. Wrote exploration script with iPhone 14 viewport + touch mode
3. Programmatic text selection + event dispatch to trigger popup
4. Measured DOM geometry vs viewport to find overflow/clipping
5. Simulated keyboard height to check input visibility
6. Checked touch target sizes against Apple HIG (44x44pt minimum)

### Limitations
- Can't test real WebKit/Safari behavior (long-press, native context menu)
- Keyboard simulation is approximate (real iOS uses `visualViewport` API)
- Touch events emulated via Playwright, not identical to real iOS

---

## Bugs Found

### BUG-1: Bottom sheet overflows viewport (28px clipped)
- **Severity**: High
- **Data**: Popup bottom=692px, viewport=664px → 28px invisible
- **Root cause**: Bottom sheet has `bottom: 0` but padding/border adds height that extends past the viewport edge. CSS `overflow-y: visible` means no scrollbar.
- **User impact**: Bottom portion of buttons potentially cut off on shorter viewports

### BUG-2: Text selection visually lost when tapping popup buttons
- **Severity**: Medium
- **Data**: Selection text before tap = "有很多適合投放廣告的地方..." → after tap = ""
- **Root cause**: iOS Safari clears selection when user taps outside the selected region. Tapping the bottom sheet button = tapping outside selection.
- **Note**: The JS closure variable `selectedText` retains the value, so Ask AI still functions. But visually confusing — user thinks their selection disappeared.
- **User impact**: Confusing UX — "did it forget what I selected?"

### BUG-3: Virtual keyboard covers input field
- **Severity**: High
- **Data**: Input bottom=589px, keyboard ~300px → effective viewport=364px. Input is 225px below visible area.
- **Root cause**: Bottom sheet uses `position: fixed; bottom: 0`. When iOS keyboard appears, it shrinks the visual viewport but the fixed-position element doesn't move.
- **User impact**: User taps Ask AI, input appears, keyboard comes up → input is hidden behind keyboard. Can't see what they're typing.

### BUG-4: Touch targets below Apple HIG minimum (44pt)
- **Severity**: Medium
- **Data**: Ask AI button 84x29px, Edit button 68x29px (height should be ≥44px)
- **Root cause**: CSS padding `0.4rem 0.75rem` is too small for mobile
- **User impact**: Hard to tap accurately on phone, especially one-handed

### BUG-5: No iOS safe area handling
- **Severity**: Low-Medium (depends on iPhone model)
- **Data**: No `env(safe-area-inset-bottom)` in any CSS
- **Root cause**: Bottom sheet sits at `bottom: 0` without accounting for home indicator area
- **User impact**: On notched iPhones, bottom sheet overlaps with home indicator gesture area

### UX-1: No bottom sheet UX affordances
- **Severity**: Low
- **Data**: No drag handle, no backdrop overlay, no close gesture
- **Root cause**: Bottom sheet is minimal — just repositioned popup
- **User impact**: Doesn't feel native; no visual cue that it's a dismissable sheet

---

## Test File
See `tests/ai-popup-iphone.spec.ts` for red tests covering BUG-1 through BUG-5.
