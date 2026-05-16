# WCAG Contrast Math

## Formula

```
L(c) = 0.2126·R + 0.7152·G + 0.0722·B
  where R, G, B are the sRGB→linear transform of the channel value:
    v = c / 255
    linear = v ≤ 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ^ 2.4

contrast(a, b) = (max(L_a, L_b) + 0.05) / (min(L_a, L_b) + 0.05)
```

## Thresholds (WCAG 2.1)

- **AA normal text**: ≥ 4.5:1
- **AA large text** (≥ 18pt or ≥ 14pt bold): ≥ 3:1
- **AAA normal text**: ≥ 7:1
- **AAA large text**: ≥ 4.5:1
- **UI components / graphical objects**: ≥ 3:1

gu-log targets AA normal text everywhere unless a specific element is explicitly oversized and documented.

## One-liner (node)

```bash
node -e '
const lum = h => {
  const r = parseInt(h.slice(1,3),16)/255,
        g = parseInt(h.slice(3,5),16)/255,
        b = parseInt(h.slice(5,7),16)/255;
  const lin = c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
};
const ratio = (a,b) => { const la=lum(a), lb=lum(b); return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05); };
console.log(ratio(process.argv[1], process.argv[2]).toFixed(2));
' "#ffb3e0" "#44475a"
```

## Worked example — the bug this skill was born to catch

- `#ff9fda` (pink) on `#eee8d5` (Solarized light surface)
  - L_fg ≈ 0.512, L_bg ≈ 0.811
  - contrast = (0.861) / (0.562) ≈ **1.53:1** → fails AA hard
- Fix: `#195d8c` on `#eee8d5`
  - L_fg ≈ 0.125, L_bg ≈ 0.811
  - contrast = (0.861) / (0.175) ≈ **5.73:1** → passes AA comfortably

The lesson: a color that reads as "link-colored" on dark surfaces can be visually invisible on cream, and vice versa. Always test both.

## Checker script

The repo ships `scripts/check-contrast.mjs` which reads color declarations annotated with `/* ... on #xxxxxx */` comments and fails pre-commit if any pair is below 4.5:1. When introducing a new color, always annotate both theme variants:

```css
:root {
  --color-source-link: #ffb3e0; /* soft pink — 5.54:1 on #44475a */
}
[data-theme='light'] {
  --color-source-link: #195d8c; /* navy — 5.73:1 on #eee8d5 */
}
```
