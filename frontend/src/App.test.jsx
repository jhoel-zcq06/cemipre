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
      getDriveSyncState: vi.fn(async () => null),
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
    });
    expect(api.createLog).not.toHaveBeenCalled();

    // Si ahora se pega un enlace existente de Google Docs, usa api.createLog sin crear en Drive
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
    });
  });
});
