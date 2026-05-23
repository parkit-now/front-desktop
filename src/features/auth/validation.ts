export type AuthField = 'email' | 'password';
export type FieldErrors = Partial<Record<AuthField, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Ingresá tu email';
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Email inválido';
  }
  return null;
}

export function validatePassword(
  value: string,
  { isNew }: { isNew: boolean } = { isNew: false },
): string | null {
  if (!value) {
    return 'Ingresá tu contraseña';
  }
  if (isNew && value.length < 8) {
    return 'Mínimo 8 caracteres';
  }
  return null;
}
