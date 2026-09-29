/** สถานะหน้ารอบนำเข้าอยู่ใน URL เพื่อให้ F5 และลิงก์กลับเปิดที่เดิม */
export type IntakeStep = 1 | 2 | 3;
export type ReviewPanel = "issues" | "missing" | null;

export function parseIntakeLocation(
  stepParam: string | undefined,
  panelParam: string | undefined,
  defaultStep: IntakeStep,
): { step: IntakeStep; panel: ReviewPanel } {
  const step: IntakeStep = stepParam === "1" ? 1 : stepParam === "2" ? 2 : stepParam === "3" ? 3 : defaultStep;
  const panel: ReviewPanel = step === 3 && (panelParam === "issues" || panelParam === "missing") ? panelParam : null;
  return { step, panel };
}

/** เปลี่ยนแค่พารามิเตอร์ของขั้นตอน โดยรักษาพารามิเตอร์/anchor อื่นไว้ */
export function intakeLocationUrl(current: string, step: IntakeStep, panel: ReviewPanel = null): string {
  const url = new URL(current);
  url.searchParams.set("step", String(step));
  if (step === 3 && panel) url.searchParams.set("panel", panel);
  else url.searchParams.delete("panel");
  return `${url.pathname}${url.search}${url.hash}`;
}
