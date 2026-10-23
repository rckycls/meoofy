/** Digits in the emailed sign-in code. */
export const CODE_LENGTH = 6

// Deliberately loose: something@something.tld. The server decides whether an address really exists.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim())
}

/** What is typed or pasted into the code field: its digits, at most `CODE_LENGTH`. */
export function codeDigits(text: string): string {
  return text.replace(/\D/g, '').slice(0, CODE_LENGTH)
}
