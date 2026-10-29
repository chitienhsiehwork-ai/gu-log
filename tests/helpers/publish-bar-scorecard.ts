/** 一份 tribunalVersion 9 的完整四評審分數，每個維度與分數都是 n；9 通過 publish bar，6 沒過。 */
const dims = (keys: string[], n: number) => Object.fromEntries(keys.map((key) => [key, n]));

export const scorecard = (n: number) => ({
  tribunalVersion: 9,
  vibe: { ...dims(['persona', 'moguNote', 'vibe', 'narrative'], n), score: n },
  factCheck: {
    ...dims(['accuracy', 'fidelity', 'consistency', 'sourceBoundary', 'commentarySeparation'], n),
    score: n,
  },
  librarian: { ...dims(['glossary', 'crossRef', 'sourceAlign', 'attribution'], n), score: n },
  freshEyes: {
    ...dims(['readability', 'firstImpression', 'payoffDensity', 'lengthFit', 'clarity'], n),
    score: n,
  },
});
