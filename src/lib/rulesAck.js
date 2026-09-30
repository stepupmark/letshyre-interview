export const RULES_ACK_KEY = "rules_acknowledged";

const LIMIT_KEYS = ["strikes", "faceInARow", "faceTotal", "disconnects", "heldSeconds"];

/** The desktop app's record that the candidate accepted the rules, or null. */
export function readRulesAck(storage = sessionStorage) {
  let ack;
  try {
    ack = JSON.parse(storage.getItem(RULES_ACK_KEY));
  } catch {
    return null;
  }
  if (!ack || typeof ack !== "object" || !Number.isInteger(ack.version)) return null;
  return ack;
}

/** True only when the candidate saw exactly the rules and numbers this build enforces. */
export function ackMatches(ack, rules) {
  if (!ack || ack.version !== rules.version) return false;
  return LIMIT_KEYS.every((key) => ack[key] === rules[key]);
}
