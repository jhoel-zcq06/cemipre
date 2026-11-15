import { useEffect, useRef } from 'react';
import { Notice } from './SharedUI.jsx';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Modal accesible con trampa de foco (focus trap), cierre con Escape
 * y retorno de foco al elemento que abrió el diálogo (MOB-01).
 */
export function Modal({ title, onClose, children }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const container = dialogRef.current;

    const focusFirst = () => {
      if (!container) return;
      const autoTarget = container.querySelector('[data-autofocus="true"]');
      const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
      const target = autoTarget || focusables[0] || container;
      target?.focus();
    };
    const timer = window.setTimeout(focusFirst, 10);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab' && container) {
        const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar ventana"
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function FormActions({ onCancel, saving, action = 'Guardar', danger = false }) {
  return (
    <div className="form-actions">
      <button className="btn btn-ghost" type="button" onClick={onCancel}>
        Cancelar
      </button>
      <button
        className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
        type="submit"
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? 'Procesando…' : action}
      </button>
    </div>
  );
}

const MODAL_TITLES = {
  'new-person': 'Registrar usuario',
  'edit-person': 'Editar usuario',
  'delete-person': 'Eliminar usuario',
  'new-log': 'Agregar bitácora',
  'edit-log': 'Configurar bitácora',
  'delete-log': 'Eliminar ficha de bitácora',
  'new-event': 'Crear evento',
  'edit-event': 'Editar evento',
  'delete-event': 'Eliminar evento',
  'profile-settings': 'Mi perfil y notificaciones',
};

export function AppModal({
  modal,
  form,
  saving,
  error,
  onUpdateField,
  onClose,
  onSubmit,
}) {
  if (!modal) return null;

  const isDelete = modal.startsWith('delete-');

  return (
    <Modal title={MODAL_TITLES[modal] || 'Formulario'} onClose={onClose}>
      <form onSubmit={onSubmit} className="form-grid">
        {error && <Notice kind="error">{error}</Notice>}

        {(modal === 'new-person' || modal === 'edit-person') && (
          <>
            <label>
              Código identificador
              <input
                data-autofocus="true"
                maxLength={32}
                required
                placeholder="Ej.: USR-004"
                value={form.codigo || ''}
                onChange={(e) => onUpdateField('codigo', e.target.value)}
              />
            </label>
            <label>
              Nombre o alias de referencia
              <input
                maxLength={120}
                required
                placeholder="Ej.: Usuario 004"
                value={form.nombre || ''}
                onChange={(e) => onUpdateField('nombre', e.target.value)}
              />
            </label>
            <label>
              Carpeta en Google Drive (URL o ID, opcional)
              <input
                maxLength={500}
                placeholder="Ej.: https://drive.google.com/drive/folders/... o 1AbCdEf..."
                value={form.drive_folder_id || ''}
                onChange={(e) => onUpdateField('drive_folder_id', e.target.value)}
              />
            </label>
            <p className="form-hint">
              Si vinculas el ID de carpeta de Drive, la sincronización detectará automáticamente los Google Docs del usuario.
            </p>
          </>
        )}

        {modal === 'delete-person' && (
          <>
            <Notice kind="warn">
              ¿Confirmas eliminar al usuario <strong>{form.codigo} ({form.nombre})</strong>?
              Se eliminarán sus fichas de bitácora y comentarios en la plataforma (los archivos en Google Drive no se borran).
            </Notice>
          </>
        )}

        {(modal === 'new-log' || modal === 'edit-log') && (
          <>
            <label>
              Nombre de la bitácora
              <input
                data-autofocus="true"
                maxLength={160}
                required
                placeholder="Ej.: Seguimiento general"
                value={form.titulo || ''}
                onChange={(e) => onUpdateField('titulo', e.target.value)}
              />
            </label>
            <label>
              Enlace de Google Docs (opcional)
              <input
                type="url"
                maxLength={500}
                placeholder="https://docs.google.com/document/d/.../edit"
                value={form.url_docs || ''}
                onChange={(e) => onUpdateField('url_docs', e.target.value)}
              />
            </label>
            <p className="form-hint">
              El ID del documento se extrae automáticamente para resúmenes IA y detección de cambios.
              La edición del contenido se realiza directamente en Google Docs.
            </p>
          </>
        )}

        {modal === 'delete-log' && (
          <Notice kind="warn">
            ¿Confirmas desvincular y eliminar la ficha <strong>{form.titulo}</strong> de esta plataforma?
            El documento original en Google Docs permanecerá intacto.
          </Notice>
        )}

        {(modal === 'new-event' || modal === 'edit-event') && (
          <>
            <label>
              Nombre del evento
              <input
                data-autofocus="true"
                maxLength={160}
                required
                placeholder="Ej.: Reunión de coordinación"
                value={form.titulo || ''}
                onChange={(e) => onUpdateField('titulo', e.target.value)}
              />
            </label>
            <div className="two-fields">
              <label>
                Inicio
                <input
                  required
                  type="datetime-local"
                  value={form.inicio || ''}
                  onChange={(e) => onUpdateField('inicio', e.target.value)}
                />
              </label>
              <label>
                Fin
                <input
                  required
                  type="datetime-local"
                  value={form.fin || ''}
                  onChange={(e) => onUpdateField('fin', e.target.value)}
                />
              </label>
            </div>
            <label>
              Responsable
              <input
                maxLength={120}
                value={form.responsable || ''}
                placeholder="Equipo CEMIPRE"
                onChange={(e) => onUpdateField('responsable', e.target.value)}
              />
            </label>
            <label>
              Descripción (opcional)
              <textarea
                maxLength={2000}
                rows={3}
                value={form.descripcion || ''}
                onChange={(e) => onUpdateField('descripcion', e.target.value)}
              />
            </label>
          </>
        )}

        {modal === 'delete-event' && (
          <Notice kind="warn">
            ¿Confirmas eliminar el evento <strong>{form.titulo}</strong> del calendario compartido?
          </Notice>
        )}

        {modal === 'profile-settings' && (
          <>
            <label>
              Correo institucional
              <input type="email" value={form.email || ''} disabled />
            </label>
            <label>
              Nombre para auditoría y equipo
              <input
                data-autofocus="true"
                maxLength={120}
                required
                value={form.nombre || ''}
                onChange={(e) => onUpdateField('nombre', e.target.value)}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(form.recibir_notificaciones)}
                onChange={(e) => onUpdateField('recibir_notificaciones', e.target.checked)}
              />
              <span>Recibir avisos por correo cuando se edite una bitácora en Google Docs</span>
            </label>
            <p className="form-hint">
              Rol actual asignado: <strong>{form.rol}</strong>.
            </p>
          </>
        )}

        <FormActions
          saving={saving}
          onCancel={onClose}
          danger={isDelete}
          action={
            isDelete
              ? 'Confirmar eliminación'
              : modal === 'new-event'
                ? 'Crear evento'
                : 'Guardar'
          }
        />
      </form>
    </Modal>
  );
}
