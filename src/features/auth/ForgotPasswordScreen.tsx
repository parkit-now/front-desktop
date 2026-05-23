import { useState, type FormEvent } from 'react';
import { requestPasswordReset } from '../../lib/api/auth';
import { translateApiError } from '../../lib/api/translate';
import { useToast } from '../../lib/notifications/ToastProvider';
import { validateEmail, type FieldErrors } from './validation';

type Props = {
  onBackToLogin: () => void;
};

export function ForgotPasswordScreen({ onBackToLogin }: Props) {
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const emailError = validateEmail(email);
    if (emailError) {
      setErrors({ email: emailError });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await requestPasswordReset(email);
      setSubmitted(true);
    } catch (error) {
      showToast({
        message: translateApiError(error, { endpoint: 'auth.forgotPassword' }),
        kind: 'error',
      });
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <>
        <h2>Revisá tu email</h2>
        <p>
          Si la dirección está registrada, te enviamos un link para elegir una
          nueva contraseña. Abrilo desde tu navegador para terminar el cambio.
        </p>
        <button
          type="button"
          className="primary-button"
          onClick={onBackToLogin}
        >
          Volver a iniciar sesión
        </button>
      </>
    );
  }

  return (
    <>
      <h2>Recuperá tu contraseña</h2>
      <p className="muted">
        Ingresá el email con el que te registraste y te enviaremos un link para
        elegir una nueva contraseña.
      </p>

      <form
        className="auth-form"
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <div className="form-field">
          <input
            type="email"
            aria-label="Email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'forgot-email-error' : undefined}
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
            <p id="forgot-email-error" className="field-error">
              {errors.email}
            </p>
          ) : null}
        </div>

        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? 'Enviando...' : 'Enviar link'}
        </button>
      </form>

      <p className="form-helper">
        <button
          type="button"
          className="link-button"
          onClick={onBackToLogin}
          disabled={pending}
        >
          Volver a iniciar sesión
        </button>
      </p>
    </>
  );
}
