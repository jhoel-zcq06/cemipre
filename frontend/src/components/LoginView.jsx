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
        <BrandHeader subtitle="Plataforma centralizada de bitácoras" />

        <h1 id="auth-title" className="auth-title">
          {mode === 'login' ? 'Iniciar sesión de trabajador' : 'Solicitar acceso al equipo'}
        </h1>
        <p className="subtitle">
          Acceso restringido al equipo autorizado de Fundación CEMIPRE.
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
                ? 'Entrar a la plataforma'
                : 'Crear solicitud de cuenta'}
          </button>
        </form>

        <div className="auth-divider"><span>o bien</span></div>

        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={handleGoogleLogin}
          disabled={busy || !isSupabaseConfigured}
        >
          Continuar con Google (con acceso privado a Drive)
        </button>

        <p className="auth-footnote">
          Al ingresar con Google puedes acceder y seleccionar carpetas o bitácoras privadas de Drive
          sin publicar enlaces. Las cuentas nuevas quedan en estado <strong>pendiente</strong> hasta
          ser aprobadas por un administrador (o si el correo está en lista blanca institucional).
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
          Tu sesión está activa como <strong>{perfil?.nombre || email}</strong> ({perfil?.email || email}),
          pero tu rol actual es <strong>pendiente</strong>.
        </Notice>
        <p className="subtitle">
          Por protección de los datos de personas atendidas en CEMIPRE, un administrador debe
          habilitar tu perfil como <code>trabajador</code> o <code>admin</code> antes de mostrar
          las bitácoras.
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
