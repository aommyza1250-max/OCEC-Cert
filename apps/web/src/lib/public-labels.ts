/** English labels shown only on the public certificate search page. */
const ROUND_LABELS: Record<string, string> = {
  HEAT: "Heat Round",
  FINAL: "Final Round",
};

const AWARD_LABELS: Record<string, string> = {
  "1ST_PRIZE": "1ST PRIZE AWARD",
  "2ND_PRIZE": "2ND PRIZE AWARD",
  "3RD_PRIZE": "3RD PRIZE AWARD",
  MERIT: "MERIT AWARD",
  PARTICIPATION: "PARTICIPATION",
  GOLD: "GOLD AWARD",
  SILVER: "SILVER AWARD",
  BRONZE: "BRONZE AWARD",
  PERFECT_SCORE: "PERFECT SCORE",
  SPECIAL_AWARD: "SPECIAL AWARD",
};

export function publicRoundLabel(round: string): string {
  return Object.hasOwn(ROUND_LABELS, round) ? ROUND_LABELS[round] : round;
}

export function publicAwardLabel(code: string, savedLabel: string): string {
  return Object.hasOwn(AWARD_LABELS, code) ? AWARD_LABELS[code] : savedLabel.toUpperCase();
}
