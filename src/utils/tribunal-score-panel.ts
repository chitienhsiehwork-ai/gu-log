type TribunalPanelScores = {
  tribunalVersion?: number;
  freshEyes?: {
    clarity?: number;
  };
  vibe?: {
    clarity?: number;
  };
};

export function clarityLivesInFreshEyes(tribunalVersion?: number): boolean {
  return (tribunalVersion ?? 3) >= 6;
}

export function resolveFreshEyesClarity(scores?: TribunalPanelScores): number | undefined {
  if (!scores || !clarityLivesInFreshEyes(scores.tribunalVersion)) return undefined;
  return scores.freshEyes?.clarity ?? scores.vibe?.clarity;
}

export function resolveVibeClarity(scores?: TribunalPanelScores): number | undefined {
  if (!scores || clarityLivesInFreshEyes(scores.tribunalVersion)) return undefined;
  return scores.vibe?.clarity ?? scores.freshEyes?.clarity;
}
