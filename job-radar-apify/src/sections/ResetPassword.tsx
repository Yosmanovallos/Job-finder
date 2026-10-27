import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { translateAuthError } from "../lib/auth-error-messages.js";
import { AuthShell, AuthSpinner, AuthText, AuthTitle, authInputClass, authPrimaryButtonClass } from "../components/AuthShell.js";

export default function ResetPassword() {
  const { loading, passwordRecovery, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setBusy(true);
    try {
      const result = await updatePassword(password);
      if (result.error) {
        setError(translateAuthError(result.error));
        return;
      }
      setDone(true);
    } catch (e) {
      setError(translateAuthError((e as Error)?.message));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <AuthSpinner />;

  return (
    <AuthShell>
      {done ? (
        <>
          <AuthTitle>Contraseña actualizada</AuthTitle>
          <AuthText>Ya puedes usar tu nueva contraseña la próxima vez que inicies sesión.</AuthText>
          <button type="button" className={authPrimaryButtonClass} onClick={() => navigate('/dashboard')}>
            Ver vacantes
          </button>
        </>
      ) : !passwordRecovery ? (
        <>
          <AuthTitle>Enlace no válido</AuthTitle>
          <AuthText>
            Este enlace de recuperación no es válido o ya expiró. Solicita uno nuevo desde
            la pantalla de inicio de sesión.
          </AuthText>
          <Link to="/login" className={authPrimaryButtonClass}>Volver a iniciar sesión</Link>
        </>
      ) : (
        <>
          <AuthTitle>Elige una nueva contraseña</AuthTitle>
          <AuthText>Escríbela dos veces para confirmar que no hay errores de tipeo.</AuthText>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              required
              minLength={8}
              placeholder="Nueva contraseña"
              aria-label="Nueva contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="Confirma la nueva contraseña"
              aria-label="Confirma la nueva contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={authInputClass}
            />

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <button type="submit" className={authPrimaryButtonClass} disabled={busy}>
              {busy ? 'Guardando...' : 'Guardar nueva contraseña'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
