import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";

export default function Login() {
  const { loginWithGoogle, loginWithEmail, signUpWithEmail } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupSent, setSignupSent] = useState(false);

  const handleGoogle = async () => {
    setError(null);
    try {
      await loginWithGoogle();
    } catch (e: any) {
      setError(e?.message || 'No se pudo iniciar sesión con Google.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const result = mode === 'login'
      ? await loginWithEmail(email, password)
      : await signUpWithEmail(email, password);

    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (mode === 'signup') {
      setSignupSent(true);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <section className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#0A0B0D" }}>
      <div className="w-full max-w-sm p-6 rounded-2xl border border-[#262A31] bg-[#131519]">
        <h1 className="text-xl font-bold text-slate-100 mb-1 font-heading">
          {mode === 'login' ? 'Inicia sesión' : 'Crea tu cuenta'}
        </h1>
        <p className="text-xs text-slate-400 mb-6 font-mono">
          Accede a Job Radar para lanzar escaneos y desbloquear el plan Pro.
        </p>

        <button
          onClick={handleGoogle}
          className="w-full mb-4 px-4 py-3 rounded-lg border border-[#262A31] bg-[#0A0B0D] text-slate-100 text-sm font-semibold hover:bg-[#1B1E24] transition-all"
        >
          Continuar con Google
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 h-px bg-[#262A31]" />
          <span className="text-[11px] text-slate-500 font-mono">o con tu correo</span>
          <div className="flex-1 h-px bg-[#262A31]" />
        </div>

        {signupSent ? (
          <p className="text-sm text-emerald-400 font-mono">
            Revisa tu correo para confirmar la cuenta antes de iniciar sesión.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="tucorreo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[#0A0B0D] border border-[#262A31] text-slate-100 text-sm placeholder-slate-500 focus:outline-none"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[#0A0B0D] border border-[#262A31] text-slate-100 text-sm placeholder-slate-500 focus:outline-none"
            />

            {error && <p className="text-xs text-red-400 font-mono">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all disabled:opacity-50"
            >
              {busy ? 'Procesando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            </button>
          </form>
        )}

        <button
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setSignupSent(false); }}
          className="w-full mt-4 text-xs text-slate-400 hover:text-slate-200 font-mono"
        >
          {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
        </button>
      </div>
    </section>
  );
}
