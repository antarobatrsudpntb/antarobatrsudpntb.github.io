export type WaEventType = "REGISTER" | "PENDING" | "FAILED" | "FOLLOWUP" | "REDELIVERY" | "MANUAL_VERIFICATION";

export const WA_EVENT_TYPES: readonly WaEventType[] = Object.freeze([
  "REGISTER", "PENDING", "FAILED", "FOLLOWUP", "REDELIVERY", "MANUAL_VERIFICATION",
]);

export function waEventKey(deliveryId: string, eventType: WaEventType, attemptNo?: number) {
  const id = String(deliveryId || "").trim();
  if (!id) throw new Error("deliveryId wajib untuk waEventKey.");
  if (!WA_EVENT_TYPES.includes(eventType)) throw new Error(`WA event tidak diizinkan: ${eventType}`);
  const withAttempt = ["PENDING", "FAILED", "FOLLOWUP", "REDELIVERY"].includes(eventType);
  if (!withAttempt) return `${id}|${eventType}`;
  const attempt = Math.max(1, Number(attemptNo || 1));
  return `${id}|${eventType}|ATTEMPT-${attempt}`;
}

export function isWaMethodAllowed(method: string) {
  return new Set([
    "prepareWhatsApp",
    "pharmacyRegistrationWaAction",
    "failedFollowUpWhatsApp",
    "getManualReceiptConfirmationWaAction",
  ]).has(method);
}
