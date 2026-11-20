import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isSupabaseConfigured: true,
    api: {
      getSession: vi.fn(async () => ({ user: { id: 'u-1', email: 'admin@cemipre.cl' } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getMyProfile: vi.fn(async () => ({
        id: 'u-1',
        email: 'admin@cemipre.cl',
        nombre: 'Admin Prueba',
        rol: 'admin',
        recibir_notificaciones: true,
      })),
      getOverviewStats: vi.fn(async () => ({
        totalPersonas: 2,
        totalBitacoras: 1,
        totalVinculadas: 1,
        totalEventos: 0,
      })),
      listFavorites: vi.fn(async () => []),
      events: vi.fn(async () => ({ eventos: [] })),
      createEvent: vi.fn(async (payload) => ({ id: 77, ...payload })),
      getDriveSyncState: vi.fn(async () => null),
      getGoogleDriveStatus: vi.fn(async () => ({
        conectado: true,
        google_email: 'admin@cemipre.cl',
        status: 'conectado',
        tiene_refresh_token: true,
        es_institucional: true,
        institucional: { conectado: true, google_email: 'admin@cemipre.cl', status: 'conectado', es_propia: true },
      })),
      subscribeDriveSyncState: vi.fn(() => () => {}),
      syncDrive: vi.fn(async () => ({
        ok: true,
        skipped: false,
        hubo_cambios: false,
        personas_procesadas: 2,
        nuevas_bitacoras: 0,
        bitacoras_actualizadas: 1,
      })),
      browseDrive: vi.fn(async () => ({
        ok: true,
        items: [
          {
            id: 'privateDoc987654',
            name: 'Bitácora Privada Google',
            kind: 'doc',
            url: 'https://docs.google.com/document/d/privateDoc987654/edit',
            modified_time: '2026-11-19T12:00:00Z',
          },
        ],
        next_page_token: '',
      })),
      createLogsFromDrive: vi.fn(async ({ persona_id, docs }) => ({
        inserted: docs.map((d, idx) => ({
          id: 50 + idx,
          persona_id,
          titulo: d.name,
          url_docs: d.url,
          google_doc_id: d.id,
          estado_sync: 'sincronizada',
        })),
        skipped: 0,
      })),
      createUser: vi.fn(async ({ codigo, nombre, drive_folder_id, drive_folder_name }) => ({
        id: 99,
        codigo,
        nombre,
        drive_folder_id,
        drive_folder_name,
      })),
      updateUser: vi.fn(async (id, payload) => ({ id, ...payload })),
      setDriveRootFolder: vi.fn(async (payload) => ({ ok: true, ...payload })),
      updateLog: vi.fn(async (id, payload) => ({ id, persona_id: 1, ...payload })),
      users: vi.fn(async () => ({
        personas: [
          { id: 1, codigo: 'USR-001', nombre: 'Rin', total_bitacoras: 1, drive_folder_id: 'folder-1' },
          { id: 2, codigo: 'USR-002', nombre: 'Zelda', total_bitacoras: 0, drive_folder_id: '' },
        ],
        total: 2,
        page: 1,
        totalPages: 1,
      })),
      user: vi.fn(async (id) => ({
        id,
        codigo: id === 1 ? 'USR-001' : 'USR-002',
        nombre: id === 1 ? 'Rin' : 'Zelda',
        drive_folder_id: id === 1 ? 'folder-1' : '',
        bitacoras: id === 1
          ? [{ id: 10, titulo: 'Rin-Bitacora-1', url_docs: 'https://docs.google.com/document/d/doc1/edit', actualizada: '2026-11-15T00:00:00Z', estado_sync: 'sincronizada' }]
          : [],
      })),
      listComments: vi.fn(async () => []),
      listAllLogs: vi.fn(async () => ({ bitacoras: [], total: 0, page: 1, totalPages: 1 })),
      activity: vi.fn(async () => ({ actividad: [], total: 0, page: 1, totalPages: 1 })),
      listNotifications: vi.fn(async () => ({ notificaciones: [], total: 0, page: 1, totalPages: 1 })),
      listProfiles: vi.fn(async () => []),
      listWhitelist: vi.fn(async () => []),
      canManageAdmins: vi.fn(async () => false),
      createLog: vi.fn(async ({ persona_id, titulo, url_docs }) => ({
        id: 21,
        persona_id,
        titulo,
        url_docs,
        google_doc_id: 'manualDoc123456',
        estado_sync: 'pendiente',
      })),
      createLogWithDrive: vi.fn(async ({ persona_id, titulo }) => ({
        ok: true,
        bitacora: {
          id: 20,
          persona_id,
          titulo,
          url_docs: 'https://docs.google.com/document/d/newDocId123456/edit',
          google_doc_id: 'newDocId123456',
          estado_sync: 'sincronizada',
        },
        drive: {
          user_folder_id: 'folder-1',
          bitacora_folder_id: 'sub-1',
          doc_id: 'newDocId123456',
          doc_url: 'https://docs.google.com/document/d/newDocId123456/edit',
        },
      })),
      summary: vi.fn(async (id) => ({
        es_demo: false,
        codigo: 'USR-001',
        nombre: 'Rin',
        cantidad_bitacoras: 1,
        bitacoras_leidas: 1,
        generado_en: '2026-11-15T01:30:00Z',
        modelo: 'gemini/gemini-3.5-flash-lite',
        aviso_revision: 'Requiere revisión profesional antes de tomar decisiones.',
        estado_general: `Síntesis generada correctamente para persona ${id}.`,
        avances_recientes: [{ punto: 'Avance de prueba', fuente: 'Rin-Bitacora-1', fecha: '2026-11-15' }],
        acciones_pendientes: [],
        incertidumbres: [],
        fuentes: [],
      })),
    },
  };
});

import App from './App.jsx';
import { api } from './api.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.getDriveSyncState.mockResolvedValue(null);
});

describe('Flujo de resumen IA en App', () => {
  it('mantiene visible el resumen generado tras recargar actividad y lo limpia al cambiar de usuario', async () => {
    render(<App />);

    const navUsers = await screen.findByRole('button', { name: 'Usuarios' });
    fireEvent.click(navUsers);

    const generateBtn = await screen.findByRole('button', { name: 'Generar resumen IA' });

    let resolveBgStats;
    api.getOverviewStats.mockImplementationOnce(
      () => new Promise((resolve) => { resolveBgStats = resolve; }),
    );

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText('Síntesis generada correctamente para persona 1.')).toBeInTheDocument();
      expect(typeof resolveBgStats).toBe('function');
    });
    // Incluso mientras el reload en segundo plano sigue pendiente, no debe mostrar la pantalla de carga
    expect(screen.queryByText('Cargando plataforma CEMIPRE…')).not.toBeInTheDocument();

    resolveBgStats({
      totalPersonas: 2,
      totalBitacoras: 1,
      totalVinculadas: 1,
      totalEventos: 0,
    });
    await waitFor(() => {
      expect(api.user.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText('Avance de prueba')).toBeInTheDocument();
    expect(screen.queryByText('Cargando plataforma CEMIPRE…')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Zelda/i }));
    await waitFor(() => {
      expect(screen.queryByText('Síntesis generada correctamente para persona 1.')).not.toBeInTheDocument();
    });
  });

  it('mantiene el resumen visible en Resúmenes IA sin parpadeo de carga', async () => {
    render(<App />);

    const navSummaries = await screen.findByRole('button', { name: 'Resúmenes IA' });
    fireEvent.click(navSummaries);

    const generateBtn = await screen.findByRole('button', { name: 'Generar resumen IA' });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText('Síntesis generada correctamente para persona 1.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Cargando plataforma CEMIPRE…')).not.toBeInTheDocument();
  });

  it('refresca los avisos por correo al abrir la pestaña Avisos y al pulsar Actualizar', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Avisos' });
    await waitFor(() => {
      expect(api.listNotifications.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    const initialCalls = api.listNotifications.mock.calls.length;
    api.listNotifications.mockResolvedValueOnce({
      notificaciones: [
        {
          id: 99,
          bitacora_id: 10,
          persona_id: 1,
          destinatario_email: 'admin@cemipre.cl',
          estado: 'enviada',
          detalle_error: '',
          enviada_en: '2026-11-15T12:00:00Z',
          bitacoras: { titulo: 'Rin-Bitacora-1' },
          personas: { codigo: 'USR-001', nombre: 'Rin' },
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Avisos' }));
    await waitFor(() => {
      expect(api.listNotifications.mock.calls.length).toBeGreaterThan(initialCalls);
    });
    expect(await screen.findByText(/USR-001 · Rin-Bitacora-1/)).toBeInTheDocument();

    const beforeManualRefresh = api.listNotifications.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => {
      expect(api.listNotifications.mock.calls.length).toBeGreaterThan(beforeManualRefresh);
    });
  });

  it('crea bitácora automáticamente en Drive cuando no hay enlace manual y usa createLog si se pega uno existente', async () => {
    render(<App />);

    const navUsers = await screen.findByRole('button', { name: 'Usuarios' });
    fireEvent.click(navUsers);

    const addLogBtn = await screen.findByRole('button', { name: '+ Agregar bitácora' });
    fireEvent.click(addLogBtn);

    const nameInput = await screen.findByLabelText('Nombre de la bitácora');
    fireEvent.change(nameInput, { target: { value: 'bitacorax' } });

    const autoCheck = screen.getByRole('checkbox', { name: /Crear carpeta y Google Doc en Drive automáticamente/i });
    expect(autoCheck).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(api.createLogWithDrive).toHaveBeenCalledWith({ persona_id: 1, titulo: 'bitacorax' });
      expect(api.syncDrive).toHaveBeenCalledWith({
        auto: true,
        persona_id: 1,
        cooldown_seconds: 0,
        force: true,
      });
    });
    expect(api.createLog).not.toHaveBeenCalled();

    api.syncDrive.mockClear();

    // Si ahora se pega un enlace existente de Google Docs, usa api.createLog sin crear en Drive y sincroniza
    fireEvent.click(await screen.findByRole('button', { name: '+ Agregar bitácora' }));
    fireEvent.change(await screen.findByLabelText('Nombre de la bitácora'), { target: { value: 'bitacora-manual' } });
    fireEvent.change(screen.getByLabelText(/Enlace de Google Docs/i), {
      target: { value: 'https://docs.google.com/document/d/manualDoc123456/edit' },
    });

    const disabledCheck = screen.getByRole('checkbox', { name: /Crear carpeta y Google Doc en Drive automáticamente/i });
    expect(disabledCheck).toBeDisabled();
    expect(disabledCheck).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(api.createLog).toHaveBeenCalledWith(
        {
          persona_id: 1,
          titulo: 'bitacora-manual',
          url_docs: 'https://docs.google.com/document/d/manualDoc123456/edit',
        },
        expect.objectContaining({ id: 'u-1' }),
      );
      expect(api.syncDrive).toHaveBeenCalledWith({
        auto: true,
        persona_id: 1,
        cooldown_seconds: 0,
        force: true,
      });
    });
  });

  it('sincroniza automáticamente en segundo plano al cargar cuando syncState está vencido y al elegir bitácoras desde Drive', async () => {
    api.getDriveSyncState.mockResolvedValue({
      id: 'global',
      auto_sync_enabled: true,
      auto_sync_interval_min: 5,
      sync_en_curso: false,
      ultima_sincronizacion: new Date(Date.now() - 20 * 60_000).toISOString(),
      ultimo_estado: 'Ok',
    });

    render(<App />);

    await waitFor(() => {
      expect(api.syncDrive).toHaveBeenCalledWith({ auto: true });
    });
    api.syncDrive.mockClear();

    const navUsers = await screen.findByRole('button', { name: 'Usuarios' });
    fireEvent.click(navUsers);

    const pickFromDriveBtn = await screen.findByRole('button', { name: /Elegir de Drive/i });
    fireEvent.click(pickFromDriveBtn);

    expect(await screen.findByText('Bitácora Privada Google')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar bitácora' }));

    await waitFor(() => {
      expect(api.createLogsFromDrive).toHaveBeenCalledWith(
        {
          persona_id: 1,
          docs: [expect.objectContaining({ id: 'privateDoc987654', name: 'Bitácora Privada Google' })],
        },
        expect.objectContaining({ id: 'u-1' }),
      );
      expect(api.syncDrive).toHaveBeenCalledWith({
        auto: true,
        persona_id: 1,
        cooldown_seconds: 0,
        force: true,
      });
    });
  });

  it('sincroniza automáticamente al agregar una carpeta de usuario o carpeta raíz y no muestra textos técnicos ni promocionales', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Inicio' });
    expect(screen.queryByText(/Supabase \+ RLS/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/enlaces públicos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/React \+ Supabase/i)).not.toBeInTheDocument();

    // Agregar carpeta al crear un usuario
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo usuario' }));
    fireEvent.change(await screen.findByLabelText('Código identificador'), { target: { value: 'USR-099' } });
    fireEvent.change(screen.getByLabelText('Nombre o alias de referencia'), { target: { value: 'Persona Carpeta' } });
    fireEvent.change(screen.getByLabelText('Carpeta en Google Drive (URL o ID, opcional)'), {
      target: { value: 'https://drive.google.com/drive/folders/1FolderIdForUser99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalled();
      expect(api.syncDrive).toHaveBeenCalledWith({
        auto: true,
        persona_id: 99,
        cooldown_seconds: 0,
        force: true,
      });
    });

    api.syncDrive.mockClear();

    // Agregar carpeta raíz desde Carpetas Drive
    fireEvent.click(screen.getByRole('button', { name: 'Carpetas Drive' }));
    const rootInput = await screen.findByLabelText('Pegar enlace o ID de carpeta raíz');
    fireEvent.change(rootInput, {
      target: { value: 'https://drive.google.com/drive/folders/1RootFolderId12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar carpeta raíz' }));

    await waitFor(() => {
      expect(api.setDriveRootFolder).toHaveBeenCalledWith({
        root_folder_id: 'https://drive.google.com/drive/folders/1RootFolderId12345',
        root_folder_name: '',
      });
      expect(api.syncDrive).toHaveBeenCalledWith({
        auto: true,
        cooldown_seconds: 0,
        force: true,
      });
    });
  });

  it('muestra la pestaña Calendario con vistas Mensual, Semanal y Día y permite crear eventos desde un horario', async () => {
    render(<App />);

    const navCalendar = await screen.findByRole('button', { name: 'Calendario' });
    fireEvent.click(navCalendar);

    expect(await screen.findByRole('tab', { name: 'Mensual' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Semanal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Día' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Semanal' }));
    expect(screen.getByRole('tab', { name: 'Semanal' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Día' }));
    expect(screen.getByRole('tab', { name: 'Día' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: '+ Evento este día' }));
    const titleInput = await screen.findByLabelText('Nombre del evento');
    fireEvent.change(titleInput, { target: { value: 'Coordinación semanal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taller' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear evento' }));

    await waitFor(() => {
      expect(api.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          titulo: 'Coordinación semanal',
          responsable: 'Equipo CEMIPRE',
          etiqueta: 'Taller',
        }),
        expect.objectContaining({ id: 'u-1' }),
      );
    });
  });
});
