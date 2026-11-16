import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isSupabaseConfigured } from './api.js';
import { InicioView, ResumenesIAView, FavoritosView } from './components/DashboardViews.jsx';
import { LoginView, PendingApprovalView } from './components/LoginView.jsx';
import { AppModal } from './components/Modals.jsx';
import { BrandHeader, Notice } from './components/SharedUI.jsx';
import {
  ActividadView,
  AdministracionView,
  AvisosCorreoView,
  BitacorasView,
  CalendarioView,
  CarpetasDriveView,
  UsuariosView,
} from './components/WorkspaceViews.jsx';

const BASE_TABS = [
  { id: 'inicio', label: 'Inicio', symbol: '⌂', heading: 'Resumen operativo', subtitle: 'Estado general de usuarios, bitácoras y sincronización.' },
  { id: 'usuarios', label: 'Usuarios', symbol: '▦', heading: 'Usuarios y bitácoras', subtitle: 'Gestiona fichas de usuarios, enlaces a Google Docs y notas internas.' },
  { id: 'bitacoras', label: 'Bitácoras', symbol: '≡', heading: 'Directorio de bitácoras', subtitle: 'Busca, filtra y verifica el estado de los documentos vinculados.' },
  { id: 'resumenes', label: 'Resúmenes IA', symbol: '✧', heading: 'Resúmenes asistidos por IA', subtitle: 'Síntesis desde el contenido real de Google Docs con referencias verificables.' },
  { id: 'calendario', label: 'Calendario', symbol: '▤', heading: 'Calendario compartido', subtitle: 'Agenda interna del equipo CEMIPRE.' },
  { id: 'actividad', label: 'Actividad', symbol: '◎', heading: 'Registro de actividad', subtitle: 'Auditoría de acciones realizadas por los trabajadores en la plataforma.' },
  { id: 'favoritos', label: 'Favoritos', symbol: '★', heading: 'Usuarios favoritos', subtitle: 'Accesos rápidos guardados en tu perfil.' },
  { id: 'avisos', label: 'Avisos', symbol: '✉', heading: 'Avisos por correo', subtitle: 'Historial de notificaciones enviadas al detectarse ediciones en Google Docs.' },
  { id: 'drive', label: 'Carpetas Drive', symbol: '☁', heading: 'Sincronización con Google Drive', subtitle: 'Conecta carpetas de CEMIPRE, detecta Docs nuevos y revisa permisos.' },
];

export default function App() {
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [authRefreshing, setAuthRefreshing] = useState(false);

  const [tab, setTab] = useState('inicio');
  const [stats, setStats] = useState({
    totalPersonas: 0,
    totalBitacoras: 0,
    totalVinculadas: 0,
    totalEventos: 0,
  });

  // Usuarios & detalle
  const [people, setPeople] = useState([]);
  const [peopleMeta, setPeopleMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [peoplePage, setPeoplePage] = useState(1);
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [person, setPerson] = useState(null);
  const [comments, setComments] = useState([]);
  const [favorites, setFavorites] = useState([]);

  // Directorio global de bitácoras
  const [allLogs, setAllLogs] = useState([]);
  const [logsMeta, setLogsMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [logsPage, setLogsPage] = useState(1);
  const [logsSearch, setLogsSearch] = useState('');
  const [logsFilter, setLogsFilter] = useState('all');

  // Calendario, Actividad, Notificaciones, Drive, Admin
  const [events, setEvents] = useState([]);
  const [changes, setChanges] = useState([]);
  const [activityMeta, setActivityMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [activityPage, setActivityPage] = useState(1);
  const [notifications, setNotifications] = useState([]);
  const [notifMeta, setNotifMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [notifPage, setNotifPage] = useState(1);
  const [syncState, setSyncState] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  const [canManageAdmins, setCanManageAdmins] = useState(false);

  // Resumen IA, Modales y Feedback
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const hasLoadedWorkspaceRef = useRef(false);
  const notifReqRef = useRef(0);

  const isAdmin = perfil?.rol === 'admin';
  const isAuthorizedWorker = perfil?.rol === 'admin' || perfil?.rol === 'trabajador';

  const tabs = useMemo(
    () =>
      isAdmin
        ? [
            ...BASE_TABS,
            {
              id: 'admin',
              label: 'Administración',
              symbol: '⚙',
              heading: 'Administración de accesos',
              subtitle: 'Aprueba cuentas de trabajadores y administra la lista blanca institucional.',
            },
          ]
        : BASE_TABS,
    [isAdmin],
  );

  const favoriteIds = useMemo(() => favorites.map((f) => f.persona_id), [favorites]);
  const favoriteIdsSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const loadAuthProfile = useCallback(async (activeSession) => {
    if (!activeSession?.user) {
      setPerfil(null);
      return;
    }
    try {
      const p = await api.getMyProfile(activeSession.user.id);
      setPerfil(p);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;

    api.getSession()
      .then(async (currentSession) => {
        if (!active) return;
        setSession(currentSession);
        await loadAuthProfile(currentSession);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });

    const { data } = api.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      await loadAuthProfile(nextSession);
    });

    return () => {
      active = false;
      data?.subscription?.unsubscribe();
    };
  }, [loadAuthProfile]);

  const loadWorkspaceBase = useCallback(async () => {
    if (!isAuthorizedWorker) return;
    const [statsData, favsData, eventsData, syncData] = await Promise.all([
      api.getOverviewStats(),
      api.listFavorites(),
      api.events(),
      api.getDriveSyncState(),
    ]);
    setStats(statsData);
    setFavorites(favsData);
    setEvents(eventsData.eventos);
    setSyncState(syncData);
  }, [isAuthorizedWorker]);

  useEffect(() => {
    if (!isAuthorizedWorker) {
      hasLoadedWorkspaceRef.current = false;
      setBusy(false);
      return;
    }
    let ignore = false;
    // Solo mostrar pantalla de carga inicial; los reload posteriores refrescan en segundo plano.
    if (!hasLoadedWorkspaceRef.current) {
      setBusy(true);
    }
    loadWorkspaceBase()
      .catch((err) => { if (!ignore) setError(err.message); })
      .finally(() => {
        if (ignore) return;
        hasLoadedWorkspaceRef.current = true;
        setBusy(false);
      });
    return () => { ignore = true; };
  }, [isAuthorizedWorker, loadWorkspaceBase, reload]);

  // Cargar lista paginada de personas
  useEffect(() => {
    if (!isAuthorizedWorker) return;
    let ignore = false;
    api.users({
      page: peoplePage,
      pageSize: 15,
      search,
      favoriteIds: onlyFavorites ? favoriteIds : null,
    })
      .then((res) => {
        if (ignore) return;
        setPeople(res.personas);
        setPeopleMeta({ page: res.page, totalPages: res.totalPages, total: res.total });
        setSelectedId((prev) => {
          if (prev && res.personas.some((p) => p.id === prev)) return prev;
          return prev ?? res.personas[0]?.id ?? null;
        });
      })
      .catch((err) => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [isAuthorizedWorker, peoplePage, search, onlyFavorites, favoriteIds, reload]);

  // Limpiar resumen previo solo cuando cambia el usuario seleccionado o la sesión
  useEffect(() => {
    setSummary(null);
  }, [isAuthorizedWorker, selectedId]);

  // Cargar detalle de persona seleccionada y sus comentarios internos
  useEffect(() => {
    if (!isAuthorizedWorker || selectedId === null) {
      setPerson(null);
      setComments([]);
      return;
    }
    let ignore = false;
    Promise.all([api.user(selectedId), api.listComments(selectedId)])
      .then(([personData, commentsData]) => {
        if (ignore) return;
        setPerson(personData);
        setComments(commentsData);
      })
      .catch((err) => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [isAuthorizedWorker, selectedId, reload]);

  // Cargar directorio global de bitácoras
  useEffect(() => {
    if (!isAuthorizedWorker) return;
    let ignore = false;
    api.listAllLogs({
      page: logsPage,
      pageSize: 20,
      search: logsSearch,
      statusFilter: logsFilter,
    })
      .then((res) => {
        if (ignore) return;
        setAllLogs(res.bitacoras);
        setLogsMeta({ page: res.page, totalPages: res.totalPages, total: res.total });
      })
      .catch((err) => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [isAuthorizedWorker, logsPage, logsSearch, logsFilter, reload]);

  // Cargar actividad paginada
  useEffect(() => {
    if (!isAuthorizedWorker) return;
    let ignore = false;
    api.activity({ page: activityPage, pageSize: 20 })
      .then((res) => {
        if (ignore) return;
        setChanges(res.actividad);
        setActivityMeta({ page: res.page, totalPages: res.totalPages, total: res.total });
      })
      .catch((err) => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [isAuthorizedWorker, activityPage, reload]);

  const loadNotifications = useCallback(() => {
    if (!isAuthorizedWorker) {
      notifReqRef.current++;
      return;
    }
    const reqId = ++notifReqRef.current;
    api.listNotifications({ page: notifPage, pageSize: 20 })
      .then((res) => {
        if (notifReqRef.current !== reqId) return;
        setNotifications(res.notificaciones);
        setNotifMeta({ page: res.page, totalPages: res.totalPages, total: res.total });
      })
      .catch((err) => {
        if (notifReqRef.current === reqId) setError(err.message);
      });
  }, [isAuthorizedWorker, notifPage]);

  // Cargar avisos por correo paginados y refrescar al entrar a la pestaña Avisos
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications, reload]);

  useEffect(() => {
    if (tab === 'avisos') {
      loadNotifications();
    }
  }, [tab, loadNotifications]);

  // Cargar datos administrativos si es admin
  useEffect(() => {
    if (!isAdmin) {
      setCanManageAdmins(false);
      return;
    }
    let ignore = false;
    Promise.all([
      api.listProfiles(),
      api.listWhitelist(),
      api.canManageAdmins ? api.canManageAdmins() : Promise.resolve(false),
    ])
      .then(([profData, wlData, superFlag]) => {
        if (ignore) return;
        setProfiles(profData);
        setWhitelist(wlData);
        setCanManageAdmins(Boolean(superFlag));
      })
      .catch((err) => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [isAdmin, reload]);

  async function refreshPendingProfile() {
    if (!session?.user) return;
    setAuthRefreshing(true);
    await loadAuthProfile(session);
    setAuthRefreshing(false);
  }

  async function handleSignOut() {
    setError('');
    setMessage('');
    await api.signOut();
    setPerfil(null);
    setSession(null);
  }

  async function runMutation(fn, successMessage) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await fn();
      setReload((n) => n + 1);
      setMessage(successMessage);
      setModal(null);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  const closeModal = useCallback(() => setModal(null), []);

  function openModal(type, data = {}) {
    setError('');
    setForm(data);
    setModal(type);
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submitModal(event) {
    event.preventDefault();
    const actor = perfil;

    if (modal === 'new-person') {
      const created = await runMutation(
        () => api.createUser({
          codigo: form.codigo || '',
          nombre: form.nombre || '',
          drive_folder_id: form.drive_folder_id || '',
        }, actor),
        'Usuario registrado correctamente.',
      );
      if (created) {
        setSelectedId(created.id);
        setTab('usuarios');
      }
    }

    if (modal === 'edit-person') {
      await runMutation(
        () => api.updateUser(form.id, {
          codigo: form.codigo || '',
          nombre: form.nombre || '',
          drive_folder_id: form.drive_folder_id || '',
        }, actor),
        'Datos del usuario actualizados.',
      );
    }

    if (modal === 'delete-person') {
      const deletedId = form.id;
      const res = await runMutation(
        () => api.deleteUser(deletedId, form.codigo, actor),
        `Usuario ${form.codigo} eliminado.`,
      );
      if (res !== null && selectedId === deletedId) {
        setSelectedId(null);
      }
    }

    if (modal === 'new-log') {
      const targetPersonaId = form.persona_id || selectedId;
      if (!targetPersonaId) return;
      const manualUrl = (form.url_docs || '').trim();
      const shouldCreateInDrive = !manualUrl && form.crear_en_drive !== false;

      if (shouldCreateInDrive) {
        const res = await runMutation(
          () => api.createLogWithDrive({
            persona_id: targetPersonaId,
            titulo: form.titulo || '',
          }),
          'Carpeta y Google Doc creados en Drive y sincronizados con el usuario.',
        );
        if (res?.warning) {
          setMessage(res.warning);
        }
      } else {
        await runMutation(
          () => api.createLog({
            persona_id: targetPersonaId,
            titulo: form.titulo || '',
            url_docs: manualUrl,
          }, actor),
          'Bitácora agregada.',
        );
      }
    }

    if (modal === 'edit-log') {
      await runMutation(
        () => api.updateLog(form.id, {
          titulo: form.titulo || '',
          url_docs: form.url_docs || '',
        }, actor),
        'Datos de la bitácora actualizados.',
      );
    }

    if (modal === 'delete-log') {
      await runMutation(
        () => api.deleteLog(form, actor),
        'Ficha de bitácora eliminada de la plataforma.',
      );
    }

    if (modal === 'new-event') {
      await runMutation(
        () => api.createEvent({
          titulo: form.titulo || '',
          descripcion: form.descripcion || '',
          responsable: form.responsable || 'Equipo CEMIPRE',
          inicio: form.inicio,
          fin: form.fin,
        }, actor),
        'Evento creado en el calendario compartido.',
      );
    }

    if (modal === 'edit-event') {
      await runMutation(
        () => api.updateEvent(form.id, {
          titulo: form.titulo || '',
          descripcion: form.descripcion || '',
          responsable: form.responsable || 'Equipo CEMIPRE',
          inicio: form.inicio,
          fin: form.fin,
        }, actor),
        'Evento actualizado.',
      );
    }

    if (modal === 'delete-event') {
      await runMutation(
        () => api.deleteEvent(form.id, form.titulo, actor),
        'Evento eliminado del calendario.',
      );
    }

    if (modal === 'profile-settings' && perfil) {
      const updated = await runMutation(
        () => api.updateMyProfile(perfil.id, {
          nombre: form.nombre || '',
          recibir_notificaciones: form.recibir_notificaciones,
        }),
        'Preferencias de perfil guardadas.',
      );
      if (updated) setPerfil(updated);
    }
  }

  async function handleGenerateSummary() {
    if (selectedId === null) return;
    const targetId = selectedId;
    setError('');
    setSummaryLoading(true);
    try {
      const res = await api.summary(targetId);
      if (selectedIdRef.current !== targetId) return;
      setSummary(res);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleToggleFavorite(personaId, currentlyFav) {
    setError('');
    try {
      await api.toggleFavorite(personaId, currentlyFav);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddComment(payload) {
    if (!perfil) return false;
    setError('');
    try {
      await api.createComment(payload, perfil);
      setReload((n) => n + 1);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function handleDeleteComment(commentId) {
    setError('');
    try {
      await api.deleteComment(commentId);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSyncDrive(payload = {}) {
    setError('');
    setMessage('');
    setSyncBusy(true);
    try {
      const res = await api.syncDrive(payload);
      setSyncResult(res);
      setMessage('Sincronización con Google Drive completada.');
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleChangeRole(profileId, rol) {
    setError('');
    try {
      await api.updateProfileRole(profileId, rol);
      setMessage('Rol actualizado correctamente.');
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddWhitelist(payload) {
    setError('');
    try {
      await api.addWhitelistEmail(payload);
      setMessage('Correo agregado a lista blanca.');
      setReload((n) => n + 1);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function handleRemoveWhitelist(email) {
    setError('');
    try {
      await api.removeWhitelistEmail(email);
      setMessage('Correo retirado de la lista blanca.');
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  function openUserInWorkspace(personaId) {
    setSelectedId(personaId);
    setTab('usuarios');
  }

  if (!authReady) {
    return (
      <main id="contenido" className="auth-shell">
        <div className="empty-state">Verificando sesión de CEMIPRE…</div>
      </main>
    );
  }

  if (!session) {
    return <LoginView />;
  }

  if (!isAuthorizedWorker) {
    return (
      <PendingApprovalView
        perfil={perfil}
        email={session.user?.email || ''}
        onRefresh={refreshPendingProfile}
        onSignOut={handleSignOut}
        refreshing={authRefreshing}
      />
    );
  }

  const currentTab = tabs.find((t) => t.id === tab) || tabs[0];
  const initials = (perfil.nombre || perfil.email || 'EQ')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('') || 'EQ';

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <BrandHeader subtitle="Plataforma de bitácoras" />

        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <nav className="navigation" aria-label="Secciones">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <span className="nav-symbol" aria-hidden="true">{item.symbol}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span className="status-indicator status-live" aria-hidden="true" />
          <div>
            <strong>Supabase + RLS activo</strong>
            <span>Sesión protegida ({perfil.rol})</span>
          </div>
        </div>
      </aside>

      <main id="contenido" className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            CEMIPRE <span>/</span> <strong>{currentTab.label}</strong>
          </div>
          <div className="top-actions">
            <span className="role-chip">● {perfil.rol.toUpperCase()}</span>
            <button
              type="button"
              className="profile-pill"
              onClick={() => openModal('profile-settings', perfil)}
              title="Editar perfil y preferencias de correo"
            >
              <span className="avatar" aria-hidden="true">{initials}</span>
              <span className="profile-name">{perfil.nombre || perfil.email}</span>
            </button>
            <button type="button" className="btn btn-tiny" onClick={handleSignOut}>
              Cerrar sesión
            </button>
          </div>
        </header>

        <div className="page-body">
          <div className="page-heading">
            <div>
              <p className="eyebrow">FUNDACIÓN CEMIPRE · VIÑA DEL MAR</p>
              <h1>{currentTab.heading}</h1>
              <p className="subtitle">{currentTab.subtitle}</p>
            </div>
            {(tab === 'usuarios' || tab === 'inicio') && (
              <button className="btn btn-primary" type="button" onClick={() => openModal('new-person')}>
                + Nuevo usuario
              </button>
            )}
            {tab === 'calendario' && (
              <button className="btn btn-primary" type="button" onClick={() => openModal('new-event')}>
                + Crear evento
              </button>
            )}
          </div>

          {error && <Notice kind="error" onDismiss={() => setError('')}>{error}</Notice>}
          {message && <Notice kind="success" onDismiss={() => setMessage('')}>{message}</Notice>}

          {busy ? (
            <div className="empty-state">Cargando plataforma CEMIPRE…</div>
          ) : (
            <>
              {tab === 'inicio' && (
                <InicioView
                  stats={stats}
                  favorites={favorites}
                  recentActivity={changes}
                  events={events}
                  syncState={syncState}
                  onNavigate={setTab}
                  onOpenUser={openUserInWorkspace}
                />
              )}

              {tab === 'usuarios' && (
                <UsuariosView
                  people={people}
                  peopleMeta={peopleMeta}
                  search={search}
                  onlyFavorites={onlyFavorites}
                  selectedId={selectedId}
                  person={person}
                  favoriteIdsSet={favoriteIdsSet}
                  comments={comments}
                  summary={summary}
                  summaryLoading={summaryLoading}
                  isAdmin={isAdmin}
                  currentUserId={perfil.id}
                  onSearchChange={(val) => { setSearch(val); setPeoplePage(1); }}
                  onToggleOnlyFavorites={() => { setOnlyFavorites((v) => !v); setPeoplePage(1); }}
                  onPageChange={setPeoplePage}
                  onSelectPerson={setSelectedId}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenModal={openModal}
                  onGenerateSummary={handleGenerateSummary}
                  onAddComment={handleAddComment}
                  onDeleteComment={handleDeleteComment}
                />
              )}

              {tab === 'bitacoras' && (
                <BitacorasView
                  logs={allLogs}
                  logsMeta={logsMeta}
                  search={logsSearch}
                  statusFilter={logsFilter}
                  onSearchChange={(val) => { setLogsSearch(val); setLogsPage(1); }}
                  onStatusFilterChange={(val) => { setLogsFilter(val); setLogsPage(1); }}
                  onPageChange={setLogsPage}
                  onOpenUser={openUserInWorkspace}
                  onOpenModal={openModal}
                />
              )}

              {tab === 'resumenes' && (
                <ResumenesIAView
                  people={people}
                  peopleMeta={peopleMeta}
                  search={search}
                  selectedId={selectedId}
                  person={person}
                  summary={summary}
                  summaryLoading={summaryLoading}
                  onSearchChange={(val) => { setSearch(val); setPeoplePage(1); }}
                  onPageChange={setPeoplePage}
                  onSelectPerson={setSelectedId}
                  onGenerateSummary={handleGenerateSummary}
                />
              )}

              {tab === 'calendario' && (
                <CalendarioView events={events} onOpenModal={openModal} />
              )}

              {tab === 'actividad' && (
                <ActividadView
                  changes={changes}
                  activityMeta={activityMeta}
                  onPageChange={setActivityPage}
                />
              )}

              {tab === 'favoritos' && (
                <FavoritosView
                  favorites={favorites}
                  onOpenUser={openUserInWorkspace}
                  onRemoveFavorite={(id) => handleToggleFavorite(id, true)}
                  onNavigateToUsers={() => setTab('usuarios')}
                />
              )}

              {tab === 'avisos' && (
                <AvisosCorreoView
                  notifications={notifications}
                  notifMeta={notifMeta}
                  perfil={perfil}
                  onPageChange={setNotifPage}
                  onRefresh={loadNotifications}
                  onOpenProfileSettings={() => openModal('profile-settings', perfil)}
                />
              )}

              {tab === 'drive' && (
                <CarpetasDriveView
                  syncState={syncState}
                  syncResult={syncResult}
                  syncBusy={syncBusy}
                  people={people}
                  onSyncDrive={handleSyncDrive}
                  onOpenUser={openUserInWorkspace}
                  onOpenModal={openModal}
                />
              )}

              {tab === 'admin' && isAdmin && (
                <AdministracionView
                  profiles={profiles}
                  whitelist={whitelist}
                  currentUserId={perfil.id}
                  canManageAdmins={canManageAdmins}
                  onChangeRole={handleChangeRole}
                  onAddWhitelist={handleAddWhitelist}
                  onRemoveWhitelist={handleRemoveWhitelist}
                />
              )}
            </>
          )}

          <footer className="footer">
            CEMIPRE · Plataforma colaborativa de bitácoras (React + Supabase + Google Docs)
          </footer>
        </div>
      </main>

      <AppModal
        modal={modal}
        form={form}
        saving={saving}
        error={error}
        onUpdateField={updateField}
        onClose={closeModal}
        onSubmit={submitModal}
      />
    </div>
  );
}
