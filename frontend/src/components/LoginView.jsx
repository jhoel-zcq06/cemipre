import { useState } from 'react';
import { api, isSupabaseConfigured } from '../api.js';
import { BrandHeader, Notice } from './SharedUI.jsx';

export function LoginView() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await api.signInWithPassword({ email, password });
      } else {
        const res = await api.signUp({ email, password, nombre });
        if (!res.session) {
          setInfo(
            'Cuenta creada. Revisa tu correo para confirmar la dirección; luego un administrador de CEMIPRE aprobará tu acceso.',
          );
          setMode('login');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setBusy(true);
    try {
      await api.signInWithGoogle();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main id="contenido" className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <BrandHeader subtitle="Gestión de bitácoras" />

        <h1 id="auth-title" className="auth-title">
          {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </h1>
        <p className="subtitle">
          Acceso para el equipo de Fundación CEMIPRE.
        </p>

        {!isSupabaseConfigured && (
          <Notice kind="error">
            <strong>Falta configurar Supabase.</strong> Reemplaza los valores de ejemplo en{' '}
            <code>frontend/.env.local</code> con tu <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> reales y vuelve a ejecutar <code>npm run build</code> o <code>npm run dev</code>.
          </Notice>
        )}

        {error && <Notice kind="error" onDismiss={() => setError('')}>{error}</Notice>}
        {info && <Notice kind="success" onDismiss={() => setInfo('')}>{info}</Notice>}

        <div className="auth-tabs" role="tablist" aria-label="Modo de acceso">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Ingresar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); }}
          >
            Registrarse
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form-grid">
          {mode === 'signup' && (
            <label>
              Nombre completo
              <input
                type="text"
                required
                maxLength={120}
                autoComplete="name"
                placeholder="Ej.: María González"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </label>
          )}
          <label>
            Correo electrónico
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="trabajador@cemipre.cl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy || !isSupabaseConfigured}
            aria-busy={busy}
          >
            {busy
              ? 'Verificando…'
              : mode === 'login'
                ? 'Ingresar'
                : 'Crear cuenta'}
          </button>
        </form>

        <div className="auth-divider"><span>o bien</span></div>

        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={handleGoogleLogin}
          disabled={busy || !isSupabaseConfigured}
        >
          Continuar con Google
        </button>

        <p className="auth-footnote">
          Las cuentas nuevas requieren aprobación de un administrador antes de ingresar.
        </p>
      </section>
    </main>
  );
}

export function PendingApprovalView({ perfil, email, onRefresh, onSignOut, refreshing }) {
  return (
    <main id="contenido" className="auth-shell">
      <section className="auth-card" aria-labelledby="pending-title">
        <BrandHeader subtitle="Validación de cuenta" />

        <h1 id="pending-title" className="auth-title">Acceso pendiente de aprobación</h1>
        <Notice kind="warn">
          Ingresaste como <strong>{perfil?.nombre || email}</strong> ({perfil?.email || email}).
          Tu cuenta está pendiente de aprobación.
        </Notice>
        <p className="subtitle">
          Un administrador de CEMIPRE debe aprobar tu cuenta para que puedas acceder a las bitácoras.
        </p>

        <div className="pending-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            {refreshing ? 'Comprobando…' : 'Verificar si ya fui aprobado'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onSignOut}>
            Cerrar sesión
          </button>
        </div>
      </section>
    </main>
  );
}
