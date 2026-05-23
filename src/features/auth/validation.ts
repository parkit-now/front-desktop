export type AuthField = 'email' | 'password';
export type FieldErrors = Partial<Record<AuthField, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Ingresa tu email';
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Email invalido';
  }
  return null;
}

export function validatePassword(
  value: string,
  { isNew }: { isNew: boolean } = { isNew: false },
): string | null {
  if (!value) {
    return 'Ingresa tu contrasena';
  }
  if (isNew && value.length < 8) {
    return 'Minimo 8 caracteres';
  }
  return null;
}
