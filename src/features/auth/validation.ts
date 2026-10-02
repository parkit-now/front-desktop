export type AuthField = 'name' | 'email' | 'password' | 'passwordConfirmation';
export type FieldErrors = Partial<Record<AuthField, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFullName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Este campo es obligatorio.';
  }
  if (trimmed.split(/\s+/).length < 2) {
    return 'Ingresá tu nombre y apellido';
  }
  return null;
}

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

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): string | null {
  if (!confirmation) {
    return 'Este campo es obligatorio.';
  }
  if (confirmation !== password) {
    return 'Las contraseñas no coinciden';
  }
  return null;
}
