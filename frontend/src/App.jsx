import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, hasGoogleCalendarScope, isDriveSyncStale, isSupabaseConfigured } from './api.js';
import { InicioView, ResumenesIAView, FavoritosView } from './components/DashboardViews.jsx';
import { DrivePickerModal } from './components/DrivePickerModal.jsx';
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
  { id: 'inicio', label: 'Inicio', symbol: '⌂', heading: 'Inicio', subtitle: 'Resumen de usuarios, bitácoras y agenda.' },
  { id: 'usuarios', label: 'Usuarios', symbol: '▦', heading: 'Usuarios y bitácoras', subtitle: 'Fichas de usuarios, bitácoras y notas internas.' },
  { id: 'bitacoras', label: 'Bitácoras', symbol: '≡', heading: 'Bitácoras', subtitle: 'Busca y filtra los documentos registrados.' },
  { id: 'resumenes', label: 'Resúmenes IA', symbol: '✧', heading: 'Resúmenes IA', subtitle: 'Genera un resumen de las bitácoras de un usuario.' },
  { id: 'calendario', label: 'Calendario', symbol: '▤', heading: 'Calendario', subtitle: 'Agenda compartida del equipo CEMIPRE.' },
  { id: 'actividad', label: 'Actividad', symbol: '◎', heading: 'Actividad', subtitle: 'Historial de cambios realizados por el equipo.' },
  { id: 'favoritos', label: 'Favoritos', symbol: '★', heading: 'Usuarios favoritos', subtitle: 'Accesos rápidos guardados en tu perfil.' },
  { id: 'avisos', label: 'Avisos', symbol: '✉', heading: 'Avisos por correo', subtitle: 'Historial de correos enviados por cambios en bitácoras.' },
  { id: 'drive', label: 'Carpetas Drive', symbol: '☁', heading: 'Carpetas Drive', subtitle: 'Conexión con Google Drive y carpetas vinculadas.' },
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
  const [calendarSyncState, setCalendarSyncState] = useState(null);
  const [calendarSyncBusy, setCalendarSyncBusy] = useState(false);
  const [changes, setChanges] = useState([]);
  const [activityMeta, setActivityMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [activityPage, setActivityPage] = useState(1);
  const [notifications, setNotifications] = useState([]);
  const [notifMeta, setNotifMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [notifPage, setNotifPage] = useState(1);
  const [syncState, setSyncState] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [driveStatus, setDriveStatus] = useState(null);
  const [driveAuthBusy, setDriveAuthBusy] = useState(false);
  const [drivePicker, setDrivePicker] = useState(null);
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
  const syncStateRef = useRef(null);
  syncStateRef.current = syncState;
  const pendingProviderTokensRef = useRef(null);
  const lastSavedProviderTokenRef = useRef('');
  const lastAutoSyncAttemptRef = useRef(0);
  const pendingPostConnectSyncRef = useRef(false);
  const pendingCalendarPostConnectSyncRef = useRef(false);
  const activeSyncCountRef = useRef(0);
  const syncRetryTimersRef = useRef(new Set());

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
              heading: 'Administración',
              subtitle: 'Aprueba cuentas de trabajadores y administra correos autorizados.',
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
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('drive_connected');
    const driveEmail = params.get('drive_email');
    const oauthErr = params.get('drive_oauth_error');
    const calConnected = params.get('calendar_connected');
    const calEmail = params.get('calendar_email');
    const calErr = params.get('calendar_oauth_error');
    if (!connected && !oauthErr && !calConnected && !calErr) return;

    if (calConnected === '1') {
      setMessage(
        `Google Calendar conectado${calEmail ? ` (${calEmail})` : ''}. Sincronizando eventos…`,
      );
      pendingCalendarPostConnectSyncRef.current = true;
      setTab('calendario');
    } else if (calErr) {
      setError(calErr);
      setTab('calendario');
    } else if (connected === '1') {
      setMessage(
        `Google Drive conectado${driveEmail ? ` (${driveEmail})` : ''}.`,
      );
      pendingPostConnectSyncRef.current = true;
      setTab('drive');
    } else if (oauthErr) {
      setError(oauthErr);
    }

    params.delete('drive_connected');
    params.delete('drive_email');
    params.delete('drive_inst');
    params.delete('drive_oauth_error');
    params.delete('calendar_connected');
    params.delete('calendar_email');
    params.delete('calendar_scope');
    params.delete('calendar_oauth_error');
    const qs = params.toString();
    const cleanUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', cleanUrl);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;

    const captureProviderTokens = (sess) => {
      if (sess?.provider_token) {
        pendingProviderTokensRef.current = {
          provider_token: sess.provider_token,
          provider_refresh_token: sess.provider_refresh_token || '',
        };
      }
    };

    api.getSession()
      .then(async (currentSession) => {
        if (!active) return;
        captureProviderTokens(currentSession);
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
      captureProviderTokens(nextSession);
      setSession(nextSession);
      await loadAuthProfile(nextSession);
    });

    return () => {
      active = false;
      data?.subscription?.unsubscribe();
    };
  }, [loadAuthProfile]);

  const runSilentAutoSync = useCallback(async ({ force = false, personaId, retryCount = 0 } = {}) => {
    if (typeof api.syncDrive !== 'function') return;
    const now = Date.now();
    if (!force && typeof personaId !== 'number' && now - lastAutoSyncAttemptRef.current < 180_000) {
      return;
    }
    if (typeof personaId !== 'number') {
      lastAutoSyncAttemptRef.current = now;
    }
    if (force) {
      activeSyncCountRef.current += 1;
      setSyncBusy(true);
    }
    try {
      const res = await api.syncDrive({
        auto: true,
        ...(typeof personaId === 'number' ? { persona_id: personaId } : {}),
        ...(force ? { cooldown_seconds: 0, force: true } : {}),
      });
      if (res && !res.skipped) {
        setSyncResult(res);
        if (force || res.hubo_cambios || typeof personaId === 'number') {
          setReload((n) => n + 1);
        }
      } else if (force && res?.skipped && res?.reason === 'en_curso' && retryCount < 1) {
        const timerId = window.setTimeout(() => {
          syncRetryTimersRef.current.delete(timerId);
          runSilentAutoSync({ force: true, personaId, retryCount: retryCount + 1 });
        }, 2500);
        syncRetryTimersRef.current.add(timerId);
      }
    } catch {
      // La sincronización en segundo plano no debe interrumpir al trabajador
    } finally {
      if (force) {
        activeSyncCountRef.current = Math.max(0, activeSyncCountRef.current - 1);
        if (activeSyncCountRef.current === 0) {
          setSyncBusy(false);
        }
      }
    }
  }, []);

  useEffect(() => () => {
    for (const timerId of syncRetryTimersRef.current) {
      window.clearTimeout(timerId);
    }
    syncRetryTimersRef.current.clear();
  }, []);

  // Guardar automáticamente los tokens de Google Drive cuando el usuario inicia sesión con Google
  useEffect(() => {
    if (!isAuthorizedWorker || !session?.user?.id) return;
    const pending = pendingProviderTokensRef.current || (session.provider_token
      ? {
          provider_token: session.provider_token,
          provider_refresh_token: session.provider_refresh_token || '',
        }
      : null);
    if (!pending?.provider_token || typeof api.saveGoogleDriveSession !== 'function') return;
    if (lastSavedProviderTokenRef.current === pending.provider_token) return;

    lastSavedProviderTokenRef.current = pending.provider_token;
    pendingProviderTokensRef.current = null;

    api.saveGoogleDriveSession(pending)
      .then(async (res) => {
        if (res?.ok && res?.has_drive_scope) {
          if (typeof api.getGoogleDriveStatus === 'function') {
            const st = await api.getGoogleDriveStatus();
            setDriveStatus(st);
          }
          if (res.es_institucional) {
            setReload((n) => n + 1);
          }
          runSilentAutoSync({ force: false });
        }
      })
      .catch(() => {
        // Si el servidor aún no tiene configurada la clave de cifrado OAuth, el usuario puede conectar después
      });
  }, [isAuthorizedWorker, session?.user?.id, session?.provider_token, session?.provider_refresh_token, runSilentAutoSync]);

  const loadWorkspaceBase = useCallback(async () => {
    if (!isAuthorizedWorker) return;
    const [statsData, favsData, eventsData, syncData, driveSt, calSyncSt] = await Promise.all([
      api.getOverviewStats(),
      api.listFavorites(),
      api.events(),
      api.getDriveSyncState(),
      typeof api.getGoogleDriveStatus === 'function'
        ? api.getGoogleDriveStatus()
        : Promise.resolve(null),
      typeof api.getGoogleCalendarSyncState === 'function'
        ? api.getGoogleCalendarSyncState()
        : Promise.resolve(null),
    ]);
    setStats(statsData);
    setFavorites(favsData);
    setEvents(eventsData.eventos);
    setSyncState(syncData);
    setDriveStatus(driveSt);
    setCalendarSyncState(calSyncSt);
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

  // Disparar sincronización automática en segundo plano si está vencida o tras conectar Google Drive
  useEffect(() => {
    if (!isAuthorizedWorker || !syncState) return;
    if (pendingPostConnectSyncRef.current) {
      pendingPostConnectSyncRef.current = false;
      runSilentAutoSync({ force: true });
      return;
    }
    if (isDriveSyncStale(syncState)) {
      runSilentAutoSync({ force: false });
    }
  }, [isAuthorizedWorker, syncState, runSilentAutoSync]);

  // Al volver a la pestaña del navegador y mediante Realtime, mantener datos actualizados sin F5
  useEffect(() => {
    if (!isAuthorizedWorker) return undefined;

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isDriveSyncStale(syncStateRef.current)) {
        runSilentAutoSync({ force: false });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && isDriveSyncStale(syncStateRef.current)) {
        runSilentAutoSync({ force: false });
      }
    }, 60_000);

    const unsubscribe = typeof api.subscribeDriveSyncState === 'function'
      ? api.subscribeDriveSyncState((nextState) => {
          const prevTs = syncStateRef.current?.ultima_sincronizacion;
          setSyncState((curr) => ({ ...(curr || {}), ...nextState }));
          if (nextState?.ultima_sincronizacion && nextState.ultima_sincronizacion !== prevTs) {
            setReload((n) => n + 1);
          }
        })
      : () => {};

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [isAuthorizedWorker, runSilentAutoSync]);

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
    } else if (tab === 'drive' && isDriveSyncStale(syncStateRef.current)) {
      runSilentAutoSync({ force: false });
    }
  }, [tab, loadNotifications, runSilentAutoSync]);

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
          drive_folder_name: form.drive_folder_name || '',
        }, actor),
        'Usuario registrado correctamente.',
      );
      if (created) {
        setSelectedId(created.id);
        setTab('usuarios');
        if (created.drive_folder_id || syncStateRef.current?.root_folder_id) {
          runSilentAutoSync({ force: true, personaId: created.id });
        }
      }
    }

    if (modal === 'edit-person') {
      const updated = await runMutation(
        () => api.updateUser(form.id, {
          codigo: form.codigo || '',
          nombre: form.nombre || '',
          drive_folder_id: form.drive_folder_id || '',
          drive_folder_name: form.drive_folder_name || '',
        }, actor),
        'Datos del usuario actualizados.',
      );
      if (updated?.drive_folder_id) {
        runSilentAutoSync({ force: true, personaId: updated.id });
      }
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

      const selectedDriveDocs = Array.isArray(form.selected_drive_docs) ? form.selected_drive_docs : [];
      if (selectedDriveDocs.length > 0 && typeof api.createLogsFromDrive === 'function') {
        const res = await runMutation(
          () => api.createLogsFromDrive({
            persona_id: targetPersonaId,
            docs: selectedDriveDocs,
          }, actor),
          selectedDriveDocs.length === 1
            ? 'Bitácora agregada desde Google Drive.'
            : `${selectedDriveDocs.length} bitácoras agregadas desde Google Drive.`,
        );
        if (res) {
          if (res.inserted.length === 0 && res.skipped > 0) {
            setMessage('Las bitácoras seleccionadas ya estaban vinculadas a este usuario.');
          }
          runSilentAutoSync({ force: true, personaId: targetPersonaId });
        }
        return;
      }

      const manualUrl = (form.url_docs || '').trim();
      const shouldCreateInDrive = !manualUrl && form.crear_en_drive !== false;

      if (shouldCreateInDrive) {
        const res = await runMutation(
          () => api.createLogWithDrive({
            persona_id: targetPersonaId,
            titulo: form.titulo || '',
          }),
          'Bitácora creada en Google Drive.',
        );
        if (res) {
          if (res.warning) {
            setMessage(res.warning);
          }
          runSilentAutoSync({ force: true, personaId: targetPersonaId });
        }
      } else {
        const created = await runMutation(
          () => api.createLog({
            persona_id: targetPersonaId,
            titulo: form.titulo || '',
            url_docs: manualUrl,
          }, actor),
          'Bitácora agregada.',
        );
        if (created) {
          runSilentAutoSync({ force: true, personaId: targetPersonaId });
        }
      }
    }

    if (modal === 'edit-log') {
      const updated = await runMutation(
        () => api.updateLog(form.id, {
          titulo: form.titulo || '',
          url_docs: form.url_docs || '',
        }, actor),
        'Datos de la bitácora actualizados.',
      );
      if (updated) {
        const targetPersonaId = updated.persona_id || form.persona_id || selectedId;
        runSilentAutoSync({
          force: true,
          ...(typeof targetPersonaId === 'number' ? { personaId: targetPersonaId } : {}),
        });
      }
    }

    if (modal === 'delete-log') {
      await runMutation(
        () => api.deleteLog(form, actor),
        'Ficha de bitácora eliminada de la plataforma.',
      );
    }

    if (modal === 'new-event') {
      const created = await runMutation(
        () => api.createEvent({
          titulo: form.titulo || '',
          descripcion: form.descripcion || '',
          responsable: form.responsable || 'Equipo CEMIPRE',
          etiqueta: form.etiqueta || 'General',
          color: form.color || '',
          inicio: form.inicio,
          fin: form.fin,
        }, actor),
        'Evento creado en el calendario compartido.',
      );
      if (
        created?.id
        && hasGoogleCalendarScope(driveStatus)
        && calendarSyncState?.sync_direction !== 'import_only'
        && typeof api.pushEventToGoogleCalendar === 'function'
      ) {
        api.pushEventToGoogleCalendar(created.id)
          .then(() => setReload((n) => n + 1))
          .catch(() => {});
      }
    }

    if (modal === 'edit-event') {
      const updated = await runMutation(
        () => api.updateEvent(form.id, {
          titulo: form.titulo || '',
          descripcion: form.descripcion || '',
          responsable: form.responsable || 'Equipo CEMIPRE',
          etiqueta: form.etiqueta || 'General',
          color: form.color || '',
          inicio: form.inicio,
          fin: form.fin,
        }, actor),
        'Evento actualizado.',
      );
      if (
        updated?.id
        && hasGoogleCalendarScope(driveStatus)
        && (updated.google_event_id || calendarSyncState?.sync_direction !== 'import_only')
        && typeof api.pushEventToGoogleCalendar === 'function'
      ) {
        api.pushEventToGoogleCalendar(updated.id)
          .then(() => setReload((n) => n + 1))
          .catch(() => {});
      }
    }

    if (modal === 'delete-event') {
      const googleMeta = {
        google_event_id: form.google_event_id || '',
        google_calendar_id: form.google_calendar_id || '',
      };
      const res = await runMutation(
        () => api.deleteEvent(form.id, form.titulo, actor),
        'Evento eliminado del calendario.',
      );
      if (
        res !== null
        && googleMeta.google_event_id
        && googleMeta.google_calendar_id
        && hasGoogleCalendarScope(driveStatus)
        && typeof api.deleteEventFromGoogleCalendar === 'function'
      ) {
        api.deleteEventFromGoogleCalendar(googleMeta).catch(() => {});
      }
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
    activeSyncCountRef.current += 1;
    setSyncBusy(true);
    try {
      const res = await api.syncDrive(payload);
      if (res?.skipped) {
        setMessage(
          res.reason === 'en_curso'
            ? 'Ya hay una sincronización en curso. Intenta nuevamente en unos segundos.'
            : (res.message || 'Sincronización omitida temporalmente.'),
        );
      } else {
        setSyncResult(res);
        setMessage('Sincronización con Google Drive completada.');
        setReload((n) => n + 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      activeSyncCountRef.current = Math.max(0, activeSyncCountRef.current - 1);
      if (activeSyncCountRef.current === 0) {
        setSyncBusy(false);
      }
    }
  }

  async function handleConnectGoogleDrive({ set_institutional = false } = {}) {
    if (typeof api.startGoogleDriveOAuth !== 'function') return;
    setError('');
    setDriveAuthBusy(true);
    try {
      await api.startGoogleDriveOAuth({ set_institutional });
    } catch (err) {
      setError(err.message);
      setDriveAuthBusy(false);
    }
  }

  async function handleConnectGoogleCalendar() {
    if (typeof api.startGoogleCalendarOAuth !== 'function') return;
    setError('');
    setCalendarSyncBusy(true);
    try {
      await api.startGoogleCalendarOAuth({ set_institutional: false });
    } catch (err) {
      setError(err.message);
      setCalendarSyncBusy(false);
    }
  }

  const handleSyncGoogleCalendar = useCallback(async ({ silent = false } = {}) => {
    if (typeof api.syncGoogleCalendar !== 'function') return null;
    if (!silent) {
      setError('');
      setMessage('');
    }
    setCalendarSyncBusy(true);
    try {
      const res = await api.syncGoogleCalendar({ push_local: true });
      if (res?.ultimo_estado && !silent) {
        setMessage(res.ultimo_estado);
      } else if (!silent) {
        setMessage('Sincronización con Google Calendar completada.');
      }
      setReload((n) => n + 1);
      return res;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setCalendarSyncBusy(false);
    }
  }, []);

  const handleListGoogleCalendars = useCallback(async () => {
    if (typeof api.listGoogleCalendars !== 'function') {
      return { calendars: [], sync_state: null };
    }
    return await api.listGoogleCalendars();
  }, []);

  const handleSaveGoogleCalendarConfig = useCallback(async (config) => {
    if (typeof api.saveGoogleCalendarConfig !== 'function') return false;
    setError('');
    setMessage('');
    setCalendarSyncBusy(true);
    try {
      const saved = await api.saveGoogleCalendarConfig(config);
      if (saved?.sync_state) setCalendarSyncState(saved.sync_state);
      if (typeof api.syncGoogleCalendar === 'function') {
        const res = await api.syncGoogleCalendar({ push_local: config.sync_direction === 'bidirectional' });
        setMessage(res?.ultimo_estado || 'Configuración guardada y calendario sincronizado.');
      } else {
        setMessage('Configuración de Google Calendar guardada.');
      }
      setReload((n) => n + 1);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setCalendarSyncBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthorizedWorker || !driveStatus) return;
    if (!pendingCalendarPostConnectSyncRef.current) return;
    pendingCalendarPostConnectSyncRef.current = false;
    if (hasGoogleCalendarScope(driveStatus)) {
      handleSyncGoogleCalendar({ silent: false });
    }
  }, [isAuthorizedWorker, driveStatus, handleSyncGoogleCalendar]);

  async function handleDisconnectGoogleDrive() {
    if (typeof api.disconnectGoogleDrive !== 'function') return;
    setError('');
    setMessage('');
    setDriveAuthBusy(true);
    try {
      await api.disconnectGoogleDrive();
      setMessage('Cuenta Google Drive desconectada.');
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setDriveAuthBusy(false);
    }
  }

  async function handleSetInstitutionalDrive() {
    if (typeof api.setInstitutionalDriveConnection !== 'function') return;
    setError('');
    setMessage('');
    setDriveAuthBusy(true);
    try {
      await api.setInstitutionalDriveConnection();
      setMessage('Cuenta Google configurada para el equipo.');
      setReload((n) => n + 1);
      runSilentAutoSync({ force: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setDriveAuthBusy(false);
    }
  }

  async function handleToggleAutoSync(enabled) {
    if (typeof api.setDriveAutoSync !== 'function') return;
    setError('');
    setMessage('');
    setDriveAuthBusy(true);
    try {
      await api.setDriveAutoSync({ enabled, interval_min: syncState?.auto_sync_interval_min || 5 });
      setMessage(enabled ? 'Sincronización automática activada.' : 'Sincronización automática pausada.');
      setReload((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setDriveAuthBusy(false);
    }
  }

  async function handleSaveRootFolder({ root_folder_id = '', root_folder_name = '' }) {
    if (typeof api.setDriveRootFolder !== 'function') return false;
    setError('');
    setMessage('');
    setDriveAuthBusy(true);
    try {
      await api.setDriveRootFolder({ root_folder_id, root_folder_name });
      setMessage(
        root_folder_id
          ? `Carpeta raíz guardada${root_folder_name ? ` ("${root_folder_name}")` : ''}. Sincronizando…`
          : 'Carpeta raíz desvinculada.',
      );
      setReload((n) => n + 1);
      if (root_folder_id) {
        runSilentAutoSync({ force: true });
      }
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setDriveAuthBusy(false);
    }
  }

  async function handleDrivePickerConfirm(selection) {
    const active = drivePicker;
    setDrivePicker(null);
    if (!active || !selection) return;

    if (active.target === 'person-folder') {
      setForm((prev) => ({
        ...prev,
        drive_folder_id: selection.id,
        drive_folder_name: selection.name || '',
        nombre: prev.nombre || selection.name || '',
      }));
      return;
    }

    if (active.target === 'new-log') {
      const docs = Array.isArray(selection) ? selection : [selection];
      setForm((prev) => ({
        ...prev,
        selected_drive_docs: docs,
        url_docs: '',
        crear_en_drive: false,
      }));
      return;
    }

    if (active.target === 'edit-log') {
      const doc = Array.isArray(selection) ? selection[0] : selection;
      if (!doc) return;
      setForm((prev) => ({
        ...prev,
        url_docs: doc.url || `https://docs.google.com/document/d/${doc.id}/edit`,
        titulo: prev.titulo || doc.name || '',
      }));
      return;
    }

    if (active.target === 'root-folder') {
      await handleSaveRootFolder({
        root_folder_id: selection.id,
        root_folder_name: selection.name || '',
      });
      return;
    }

    if (active.target === 'assign-user-folder' && active.context) {
      const targetUser = active.context;
      setError('');
      setMessage('');
      try {
        await api.updateUser(targetUser.id, {
          codigo: targetUser.codigo,
          nombre: targetUser.nombre,
          drive_folder_id: selection.id,
          drive_folder_name: selection.name || '',
        }, perfil);
        setMessage(`Carpeta "${selection.name}" vinculada a ${targetUser.codigo}. Sincronizando sus bitácoras…`);
        setReload((n) => n + 1);
        runSilentAutoSync({ force: true, personaId: targetUser.id });
      } catch (err) {
        setError(err.message);
      }
      return;
    }

    if (active.target === 'direct-add-logs' && active.context?.persona_id) {
      const docs = Array.isArray(selection) ? selection : [selection];
      if (docs.length === 0 || typeof api.createLogsFromDrive !== 'function') return;
      setError('');
      setMessage('');
      try {
        const res = await api.createLogsFromDrive({
          persona_id: active.context.persona_id,
          docs,
        }, perfil);
        if (res.inserted.length > 0) {
          setMessage(
            res.inserted.length === 1
              ? `Se agregó "${res.inserted[0].titulo}" desde Google Drive.`
              : `Se agregaron ${res.inserted.length} bitácoras desde Google Drive.`,
          );
        } else {
          setMessage('Las bitácoras seleccionadas ya estaban vinculadas a este usuario.');
        }
        setReload((n) => n + 1);
        runSilentAutoSync({ force: true, personaId: active.context.persona_id });
      } catch (err) {
        setError(err.message);
      }
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
      setMessage('Correo autorizado agregado.');
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
      setMessage('Correo autorizado eliminado.');
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
        <BrandHeader subtitle="Gestión de bitácoras" />

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
                  driveStatus={driveStatus}
                  onNavigate={setTab}
                  onOpenUser={openUserInWorkspace}
                  onConnectGoogleDrive={handleConnectGoogleDrive}
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
                  onOpenDrivePicker={setDrivePicker}
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
                <CalendarioView
                  events={events}
                  onOpenModal={openModal}
                  driveStatus={driveStatus}
                  calendarSyncState={calendarSyncState}
                  calendarSyncBusy={calendarSyncBusy}
                  onConnectGoogleCalendar={handleConnectGoogleCalendar}
                  onSyncGoogleCalendar={handleSyncGoogleCalendar}
                  onListGoogleCalendars={handleListGoogleCalendars}
                  onSaveGoogleCalendarConfig={handleSaveGoogleCalendarConfig}
                />
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
                  isAdmin={isAdmin}
                  driveStatus={driveStatus}
                  driveAuthBusy={driveAuthBusy}
                  onSyncDrive={handleSyncDrive}
                  onOpenUser={openUserInWorkspace}
                  onOpenModal={openModal}
                  onConnectGoogleDrive={handleConnectGoogleDrive}
                  onDisconnectGoogleDrive={handleDisconnectGoogleDrive}
                  onSetInstitutionalDrive={handleSetInstitutionalDrive}
                  onToggleAutoSync={handleToggleAutoSync}
                  onSaveRootFolder={handleSaveRootFolder}
                  onOpenDrivePicker={setDrivePicker}
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
            Fundación CEMIPRE · Viña del Mar
          </footer>
        </div>
      </main>

      <AppModal
        modal={modal}
        form={form}
        saving={saving}
        error={error}
        driveStatus={driveStatus}
        driveAuthBusy={driveAuthBusy}
        onOpenDrivePicker={setDrivePicker}
        onConnectGoogleDrive={handleConnectGoogleDrive}
        onDisconnectGoogleDrive={handleDisconnectGoogleDrive}
        onUpdateField={updateField}
        onClose={closeModal}
        onSubmit={submitModal}
      />

      <DrivePickerModal
        open={Boolean(drivePicker)}
        mode={drivePicker?.mode || 'docs'}
        multiple={drivePicker?.multiple ?? (drivePicker?.mode === 'docs')}
        title={drivePicker?.title}
        driveStatus={driveStatus}
        onConnectGoogle={() => handleConnectGoogleDrive({ set_institutional: drivePicker?.target === 'root-folder' && isAdmin })}
        onConfirm={handleDrivePickerConfirm}
        onClose={() => setDrivePicker(null)}
      />
    </div>
  );
}
