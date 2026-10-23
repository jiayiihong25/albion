export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Only known house pages are allowed as post-login destinations. */
export function safeReturnPath(value: unknown) {
  // A shared dish link returns to its day after sign-in.
  if (typeof value === "string" && /^\/dishes\?day=\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return typeof value === "string" && ["/", "/dishes", "/fridge"].includes(value) ? value : "/dishes";
}

/** Why a new password won't do, or null. Supabase stores at most 72 bytes of it. */
export function newPasswordProblem(value: unknown) {
  if (typeof value !== "string" || !value) return "Choose a password.";
  if (value.length < 8) return "Use at least 8 characters for your password.";
  if (new TextEncoder().encode(value).length > 72) return "Use a password under 72 characters.";
  return null;
}

/** Where a signed-in account that isn't a housemate yet goes to pick who they are. */
export function joinPath(next: unknown) {
  return `/join?${new URLSearchParams({ next: safeReturnPath(next) })}`;
}

const JOIN_PROBLEMS: Record<string, string> = {
  "wrong-code": "That house code isn’t right. Check the group chat and try again.",
  "too-many-tries": "Too many wrong codes. Wait 15 minutes, then try again.",
  taken: "Someone already claimed that housemate. If it’s you, ask Kevin to sort it out.",
  "joining-off": "Joining is switched off right now. Ask Kevin to set a house code.",
};

/** A friendly message for a claim_roommate result that didn't let the account in. */
export function joinProblem(result: unknown) {
  return typeof result === "string" && JOIN_PROBLEMS[result] || "We couldn’t add you to the house. Try again.";
}
