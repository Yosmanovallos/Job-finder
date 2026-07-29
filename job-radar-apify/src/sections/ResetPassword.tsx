import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { translateAuthError } from "../lib/auth-error-messages.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";

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
    } catch (e: any) {
      setError(translateAuthError(e?.message));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </section>
    );
  }

  return (
    <section className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="hud-corners w-full max-w-sm rounded-2xl border border-border bg-card overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-green-soft via-primary to-gold-2" />
        <div className="p-6">
        <img src="/BT.png" alt="BuscoTrabajo.co" className="h-6 w-auto mb-4" />
        {done ? (
          <>
            <h1 className="text-xl font-bold text-foreground mb-1 font-heading">Contraseña actualizada</h1>
            <p className="text-xs text-muted-foreground mb-6 font-mono">
              Ya puedes usar tu nueva contraseña la próxima vez que inicies sesión.
            </p>
            <Button size="lg" className="w-full" onClick={() => navigate('/dashboard')}>
              Ir al dashboard
            </Button>
          </>
        ) : !passwordRecovery ? (
          <>
            <h1 className="text-xl font-bold text-foreground mb-1 font-heading">Enlace no válido</h1>
            <p className="text-xs text-muted-foreground mb-6 font-mono">
              Este enlace de recuperación no es válido o ya expiró. Solicita uno nuevo desde
              la pantalla de inicio de sesión.
            </p>
            <Button size="lg" className="w-full" asChild>
              <Link to="/login">Volver a iniciar sesión</Link>
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-foreground mb-1 font-heading">Elige una nueva contraseña</h1>
            <p className="text-xs text-muted-foreground mb-6 font-mono">
              Escríbela dos veces para confirmar que no hay errores de tipeo.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="password"
                required
                minLength={8}
                placeholder="Nueva contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                type="password"
                required
                minLength={8}
                placeholder="Confirma la nueva contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              {error && <p className="text-xs text-destructive font-mono">{error}</p>}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? 'Guardando...' : 'Guardar nueva contraseña'}
              </Button>
            </form>
          </>
        )}
        </div>
      </div>
    </section>
  );
}
