export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Only known house pages are allowed as post-login destinations. */
export function safeReturnPath(value: unknown) {
  return typeof value === "string" && ["/", "/dishes", "/fridge"].includes(value) ? value : "/dishes";
}
