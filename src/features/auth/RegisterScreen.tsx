import { useState, type FormEvent } from 'react';
import { useToast } from '../../lib/notifications/ToastProvider';
import { registerWithEmail } from '../../lib/supabase/session';
import { mapAuthError } from './errors';
import { PasswordInput } from './PasswordInput';
import {
  validateEmail,
  validateFullName,
  validatePassword,
  validatePasswordConfirmation,
  type FieldErrors,
} from './validation';

type Props = {
  onSwitchToLogin: () => void;
};

export function RegisterScreen({ onSwitchToLogin }: Props) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const next: FieldErrors = {};
    const nameError = validateFullName(name);
    if (nameError) next.name = nameError;
    const emailError = validateEmail(email);
    if (emailError) next.email = emailError;
    const passwordError = validatePassword(password, { isNew: true });
    if (passwordError) next.password = passwordError;
    const confirmationError = validatePasswordConfirmation(
      password,
      passwordConfirmation,
    );
    if (confirmationError) next.passwordConfirmation = confirmationError;
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await registerWithEmail(name, email, password);
    } catch (error) {
      const mapped = mapAuthError(error, 'register');
      if (mapped.fieldErrors) {
        setErrors(mapped.fieldErrors);
      }
      if (mapped.toastMessage) {
        showToast({ message: mapped.toastMessage, kind: 'error' });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2>Crear cuenta</h2>

      <form
        className="auth-form"
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <p className="form-helper">
          Los campos marcados con * son obligatorios
        </p>

        <div className="form-field">
          <input
            type="text"
            aria-label="Nombre y apellido"
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'register-name-error' : undefined}
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) {
                setErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            placeholder="Nombre y apellido *"
            className={errors.name ? 'input-error' : undefined}
          />
          {errors.name ? (
            <p id="register-name-error" className="field-error">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <input
            type="email"
            aria-label="Email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'register-email-error' : undefined}
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (errors.email) {
                setErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            placeholder="Email"
            className={errors.email ? 'input-error' : undefined}
          />
          {errors.email ? (
            <p id="register-email-error" className="field-error">
              {errors.email}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <PasswordInput
            aria-label="Contraseña"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              errors.password ? 'register-password-error' : undefined
            }
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (errors.password) {
                setErrors((prev) => ({ ...prev, password: undefined }));
              }
              if (
                errors.passwordConfirmation &&
                event.target.value === passwordConfirmation
              ) {
                setErrors((prev) => ({
                  ...prev,
                  passwordConfirmation: undefined,
                }));
              }
            }}
            placeholder="Contraseña (mín. 8 caracteres)"
            className={errors.password ? 'input-error' : undefined}
          />
          {errors.password ? (
            <p id="register-password-error" className="field-error">
              {errors.password}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <PasswordInput
            aria-label="Repetir contraseña"
            aria-required="true"
            aria-invalid={errors.passwordConfirmation ? true : undefined}
            aria-describedby={
              errors.passwordConfirmation
                ? 'register-password-confirmation-error'
                : undefined
            }
            autoComplete="new-password"
            value={passwordConfirmation}
            onChange={(event) => {
              setPasswordConfirmation(event.target.value);
              if (errors.passwordConfirmation) {
                setErrors((prev) => ({
                  ...prev,
                  passwordConfirmation: undefined,
                }));
              }
            }}
            placeholder="Repetir contraseña *"
            className={errors.passwordConfirmation ? 'input-error' : undefined}
          />
          {errors.passwordConfirmation ? (
            <p
              id="register-password-confirmation-error"
              className="field-error"
            >
              {errors.passwordConfirmation}
            </p>
          ) : null}
        </div>

        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
      </form>

      <p className="form-helper">
        ¿Ya tenés cuenta?{' '}
        <button
          type="button"
          className="link-button"
          onClick={onSwitchToLogin}
          disabled={pending}
        >
          Ingresar
        </button>
      </p>
    </>
  );
}
