import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AppModal, Modal } from './components/Modals.jsx';
import { Notice } from './components/SharedUI.jsx';
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
    const { rerender } = render(<LoginView />);
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
  });
});
