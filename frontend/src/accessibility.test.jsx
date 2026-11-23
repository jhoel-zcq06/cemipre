import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppModal, Modal } from './components/Modals.jsx';
import { DrivePickerModal } from './components/DrivePickerModal.jsx';
import { CarpetasDriveView, AdministracionView } from './components/WorkspaceViews.jsx';
import { FolderSourceBadge, Notice } from './components/SharedUI.jsx';
import { LoginView, PendingApprovalView } from './components/LoginView.jsx';

afterEach(() => {
  cleanup();
});

describe('Accesibilidad de UI (Modales y Avisos aria-live)', () => {
  it('Notice asigna atributos aria-live y roles accesibles', () => {
    const { rerender } = render(<Notice kind="info">Operación completada</Notice>);
    const statusEl = screen.getByRole('status');
    expect(statusEl).toHaveAttribute('aria-live', 'polite');

    rerender(<Notice kind="error">Fallo de red</Notice>);
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toHaveAttribute('aria-live', 'assertive');
  });

  it('Modal cierra con Escape, atrapa el foco y restaura el foco al cerrarse', () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Abrir';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <Modal title="Prueba accesible" onClose={onClose}>
        <button type="button">Acción 1</button>
        <button type="button">Acción 2</button>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Prueba accesible' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const closeBtn = screen.getByRole('button', { name: 'Cerrar ventana' });
    const lastBtn = screen.getByRole('button', { name: 'Acción 2' });

    lastBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);

    closeBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('LoginView y PendingApprovalView exponen controles accesibles por teclado', () => {
    const { rerender, container } = render(<LoginView />);
    expect(container.querySelector('img[src="/cemipre-logo.png"]')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Iniciar sesión/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ingresar' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Registrarse' }));
    expect(screen.getByLabelText('Nombre completo')).toBeInTheDocument();

    const onRefresh = vi.fn();
    const onSignOut = vi.fn();
    rerender(
      <PendingApprovalView
        perfil={{ nombre: 'Trabajador Prueba', email: 'test@cemipre.cl', rol: 'pendiente' }}
        email="test@cemipre.cl"
        onRefresh={onRefresh}
        onSignOut={onSignOut}
        refreshing={false}
      />,
    );
    expect(screen.getByRole('heading', { name: /Acceso pendiente/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Verificar si ya fui aprobado/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cerrar sesión/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('AppModal mantiene el foco en Nombre o Carpeta Drive al escribir aunque onClose se recree', async () => {
    function StatefulModalWrapper() {
      const [form, setForm] = useState({ codigo: 'USER5', nombre: '', drive_folder_id: '' });
      return (
        <AppModal
          modal="new-person"
          form={form}
          saving={false}
          error=""
          onUpdateField={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          onClose={() => {}}
          onSubmit={(e) => e.preventDefault()}
        />
      );
    }

    render(<StatefulModalWrapper />);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const codeInput = screen.getByLabelText('Código identificador');
    const nameInput = screen.getByLabelText('Nombre o alias de referencia');
    const driveInput = screen.getByLabelText('Carpeta en Google Drive (URL o ID, opcional)');
    expect(document.activeElement).toBe(codeInput);

    nameInput.focus();
    expect(document.activeElement).toBe(nameInput);
    fireEvent.change(nameInput, { target: { value: 'a' } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(nameInput.value).toBe('a');
    expect(document.activeElement).toBe(nameInput);

    driveInput.focus();
    fireEvent.change(driveInput, { target: { value: 'https://drive.google.com/drive/folders/1AbCdEfGhIjK' } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(document.activeElement).toBe(driveInput);
    expect(screen.getByText(/ID detectado para usuario/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dejar solo ID' }));
    expect(driveInput.value).toBe('1AbCdEfGhIjK');
  });

  it('CarpetasDriveView extrae el ID limpio de un enlace de Drive y permite abrir nuevo usuario con él', async () => {
    const onOpenModal = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <CarpetasDriveView
        syncState={null}
        syncResult={null}
        syncBusy={false}
        people={[]}
        onSyncDrive={() => {}}
        onOpenUser={() => {}}
        onOpenModal={onOpenModal}
      />,
    );

    const extractor = screen.getByLabelText(/Extractor rápido de ID de Google Drive/i);
    fireEvent.change(extractor, {
      target: { value: 'https://drive.google.com/drive/folders/1Kt_3qhsgVXFzAC7U1K4-EMmExZVSnEsO?usp=sharing' },
    });

    expect(screen.getByText('1Kt_3qhsgVXFzAC7U1K4-EMmExZVSnEsO')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar ID' }));
    expect(writeText).toHaveBeenCalledWith('1Kt_3qhsgVXFzAC7U1K4-EMmExZVSnEsO');

    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario con este ID' }));
    expect(onOpenModal).toHaveBeenCalledWith('new-person', {
      drive_folder_id: '1Kt_3qhsgVXFzAC7U1K4-EMmExZVSnEsO',
    });
  });

  it('AdministracionView oculta controles para degradar o crear admins a administradores secundarios', () => {
    const sampleProfiles = [
      { id: 'u-main', email: 'principal@cemipre.cl', nombre: 'Principal', rol: 'admin', recibir_notificaciones: true },
      { id: 'u-sec', email: 'secundario@cemipre.cl', nombre: 'Secundario', rol: 'admin', recibir_notificaciones: true },
      { id: 'u-work', email: 'trabajador@cemipre.cl', nombre: 'Trabajador', rol: 'trabajador', recibir_notificaciones: true },
    ];
    const onChangeRole = vi.fn();

    const { rerender } = render(
      <AdministracionView
        profiles={sampleProfiles}
        whitelist={[{ email: 'vip@cemipre.cl', rol: 'admin' }]}
        currentUserId="u-sec"
        canManageAdmins={false}
        onChangeRole={onChangeRole}
        onAddWhitelist={() => Promise.resolve(true)}
        onRemoveWhitelist={() => {}}
      />,
    );

    expect(screen.queryByLabelText('Rol para principal@cemipre.cl')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rol para secundario@cemipre.cl')).not.toBeInTheDocument();
    const workerSelect = screen.getByLabelText('Rol para trabajador@cemipre.cl');
    expect(Array.from(workerSelect.options).map((o) => o.value)).toEqual(['pendiente', 'trabajador']);
    const whitelistSelect = screen.getByLabelText('Rol asignado');
    expect(Array.from(whitelistSelect.options).map((o) => o.value)).toEqual(['trabajador']);
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();

    rerender(
      <AdministracionView
        profiles={sampleProfiles}
        whitelist={[{ email: 'vip@cemipre.cl', rol: 'admin' }]}
        currentUserId="u-main"
        canManageAdmins={true}
        onChangeRole={onChangeRole}
        onAddWhitelist={() => Promise.resolve(true)}
        onRemoveWhitelist={() => {}}
      />,
    );

    expect(screen.queryByLabelText('Rol para principal@cemipre.cl')).not.toBeInTheDocument();
    const secondaryAdminSelect = screen.getByLabelText('Rol para secundario@cemipre.cl');
    expect(Array.from(secondaryAdminSelect.options).map((o) => o.value)).toEqual(['pendiente', 'trabajador', 'admin']);
    fireEvent.change(secondaryAdminSelect, { target: { value: 'trabajador' } });
    expect(onChangeRole).toHaveBeenCalledWith('u-sec', 'trabajador');
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
  });

  it('DrivePickerModal solicita conexión Google cuando no está conectado y permite navegar y seleccionar bitácoras privadas', async () => {
    const onConnectGoogle = vi.fn();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const onBrowse = vi.fn(async ({ folder_id }) => {
      if (folder_id === 'fld-usr1') {
        return {
          items: [
            {
              id: 'doc-priv-1',
              name: 'Bitácora Mayo',
              kind: 'doc',
              url: 'https://docs.google.com/document/d/doc-priv-1/edit',
              modified_time: '2026-11-18T12:00:00Z',
            },
            {
              id: 'doc-priv-2',
              name: 'Bitácora Junio',
              kind: 'doc',
              url: 'https://docs.google.com/document/d/doc-priv-2/edit',
              modified_time: '2026-11-19T12:00:00Z',
            },
          ],
          next_page_token: '',
        };
      }
      return {
        items: [
          { id: 'fld-usr1', name: 'USR-001 - Rin', kind: 'folder' },
        ],
        next_page_token: '',
      };
    });

    const { rerender } = render(
      <DrivePickerModal
        open={true}
        mode="docs"
        driveStatus={{ conectado: false, status: 'desconectado' }}
        onConnectGoogle={onConnectGoogle}
        onBrowse={onBrowse}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    const connectBtn = screen.getByRole('button', { name: /Conectar mi cuenta Google Drive/i });
    fireEvent.click(connectBtn);
    expect(onConnectGoogle).toHaveBeenCalledTimes(1);

    rerender(
      <DrivePickerModal
        open={true}
        mode="docs"
        multiple={true}
        driveStatus={{ conectado: true, google_email: 'equipo@cemipre.cl', status: 'conectado' }}
        onConnectGoogle={onConnectGoogle}
        onBrowse={onBrowse}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText('USR-001 - Rin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(await screen.findByText('Bitácora Mayo')).toBeInTheDocument();
    const selectBtns = screen.getAllByRole('button', { name: 'Seleccionar' });
    fireEvent.click(selectBtns[0]);
    fireEvent.click(selectBtns[1]);

    const confirmBtn = screen.getByRole('button', { name: /Vincular 2 bitácoras/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'doc-priv-1', name: 'Bitácora Mayo', folder_path: 'USR-001 - Rin' }),
        expect.objectContaining({ id: 'doc-priv-2', name: 'Bitácora Junio', folder_path: 'USR-001 - Rin' }),
      ]);
    });
  });

  it('FolderSourceBadge muestra la carpeta de origen cuando existe y no renderiza nada si está vacía', () => {
    const { container, rerender } = render(<FolderSourceBadge path="" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FolderSourceBadge path="2026 / Psicología / Evaluaciones" />);
    const badge = screen.getByText(/Carpeta: 2026 \/ Psicología \/ Evaluaciones/);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'Carpeta de origen en Google Drive: 2026 / Psicología / Evaluaciones');
  });
});
