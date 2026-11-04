// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import {
  change,
  cleanup,
  click,
  field,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';

const session = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signInWithProvider: vi.fn(),
  registerWithEmail: vi.fn(),
}));
const api = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));

vi.mock('../../lib/supabase/session', () => session);
vi.mock('../../lib/api/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

function submit(label: string) {
  const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ];
  return click(buttons.find((b) => b.textContent?.trim() === label)!);
}

beforeEach(() => {
  vi.clearAllMocks();
  session.signInWithEmail.mockResolvedValue({});
  session.signInWithProvider.mockResolvedValue(undefined);
  session.registerWithEmail.mockResolvedValue({});
  api.requestPasswordReset.mockResolvedValue(undefined);
});

afterEach(async () => {
  await cleanup();
});

describe('LoginScreen', () => {
  function render() {
    const onSwitchToRegister = vi.fn();
    const onForgotPassword = vi.fn();
    return mount(
      <LoginScreen
        onSwitchToRegister={onSwitchToRegister}
        onForgotPassword={onForgotPassword}
      />,
    ).then(() => ({ onSwitchToRegister, onForgotPassword }));
  }

  it('valida antes de llamar al backend', async () => {
    await render();

    await submit('Ingresar');

    expect(session.signInWithEmail).not.toHaveBeenCalled();
    expect(pageText()).toContain('Ingresá tu email');
  });

  it('inicia sesión y muestra el rechazo del backend', async () => {
    session.signInWithEmail.mockRejectedValueOnce(
      new ApiError(401, 'Unauthorized', null),
    );
    await render();

    await change(field('Email'), 'ana@parkit.test');
    await change(field('Contraseña'), 'secreto123');
    await submit('Ingresar');
    expect(document.querySelector('.toast-error')).toBeTruthy();

    await submit('Ingresar');
    expect(session.signInWithEmail).toHaveBeenLastCalledWith(
      'ana@parkit.test',
      'secreto123',
    );
  });

  it('entra con un proveedor y avisa si falla', async () => {
    session.signInWithProvider.mockRejectedValueOnce(new Error('sin bridge'));
    await render();

    await click('Continuar con GitHub');
    expect(document.querySelector('.toast-error')).toBeTruthy();

    await click('Continuar con Google');
    expect(session.signInWithProvider).toHaveBeenLastCalledWith('google');
  });

  it('lleva al registro y a recuperar la contraseña', async () => {
    const { onSwitchToRegister, onForgotPassword } = await render();

    await click('Crear una');
    await click('¿Olvidaste tu contraseña?');

    expect(onSwitchToRegister).toHaveBeenCalledOnce();
    expect(onForgotPassword).toHaveBeenCalledOnce();
  });
});

describe('RegisterScreen', () => {
  it('crea la cuenta con los datos válidos', async () => {
    await mount(<RegisterScreen onSwitchToLogin={vi.fn()} />);

    await submit('Crear cuenta');
    expect(session.registerWithEmail).not.toHaveBeenCalled();

    await change(field('Nombre y apellido'), 'Ana Pérez');
    await change(field('Email'), 'ana@parkit.test');
    await change(field('Contraseña'), 'secreto123');
    await change(field('Repetir contraseña'), 'secreto123');
    await submit('Crear cuenta');

    expect(session.registerWithEmail).toHaveBeenCalledWith(
      'Ana Pérez',
      'ana@parkit.test',
      'secreto123',
    );
  });

  it('marca contraseñas distintas y errores del backend', async () => {
    session.registerWithEmail.mockRejectedValue(
      new ApiError(409, 'Conflict', null),
    );
    const onSwitchToLogin = vi.fn();
    await mount(<RegisterScreen onSwitchToLogin={onSwitchToLogin} />);

    await change(field('Nombre y apellido'), 'Ana Pérez');
    await change(field('Email'), 'ana@parkit.test');
    await change(field('Contraseña'), 'secreto123');
    await change(field('Repetir contraseña'), 'otra-cosa');
    await submit('Crear cuenta');
    expect(pageText()).toContain('Las contraseñas no coinciden');

    await change(field('Repetir contraseña'), 'secreto123');
    await submit('Crear cuenta');
    expect(document.querySelector('.toast-error')).toBeTruthy();

    await click('Ingresar');
    expect(onSwitchToLogin).toHaveBeenCalledOnce();
  });
});

describe('ForgotPasswordScreen', () => {
  it('pide el link y confirma', async () => {
    const onBackToLogin = vi.fn();
    await mount(<ForgotPasswordScreen onBackToLogin={onBackToLogin} />);

    await change(field('Email'), 'no-es-mail');
    await submit('Enviar link');
    expect(api.requestPasswordReset).not.toHaveBeenCalled();

    await change(field('Email'), 'ana@parkit.test');
    await submit('Enviar link');

    await waitForText('Revisá tu email');
    expect(api.requestPasswordReset).toHaveBeenCalledWith('ana@parkit.test');
    await click('Volver a iniciar sesión');
    expect(onBackToLogin).toHaveBeenCalledOnce();
  });

  it('avisa si no se pudo pedir el link', async () => {
    api.requestPasswordReset.mockRejectedValue(new ApiError(500, 'x', null));
    await mount(<ForgotPasswordScreen onBackToLogin={vi.fn()} />);

    await change(field('Email'), 'ana@parkit.test');
    await submit('Enviar link');

    expect(document.querySelector('.toast-error')).toBeTruthy();
  });
});
