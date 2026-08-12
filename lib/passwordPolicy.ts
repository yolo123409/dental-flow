/**
 * Shared password policy - min 8 chars, at least one uppercase, one
 * lowercase, one digit. No extra complexity rules (symbols, etc.) beyond
 * what's actually needed. Used by the forced first-login password change,
 * the self-serve ChangePasswordModal, and to guarantee generated temporary
 * passwords (lib/generatePassword.ts) satisfy the same policy they'll be
 * replaced under.
 */
export function validatePassword(
  password: string
): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return {
      valid: false,
      message: "Password must be at least 8 characters.",
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: "Password must include at least one uppercase letter.",
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: "Password must include at least one lowercase letter.",
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must include at least one number.",
    };
  }

  return { valid: true };
}
