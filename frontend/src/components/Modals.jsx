import { useEffect, useRef } from 'react';
import { extractGoogleFolderId } from '../api.js';
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      if (container) {
        const openDialogs = document.querySelectorAll('.modal[role="dialog"]');
        if (openDialogs.length > 1 && openDialogs[openDialogs.length - 1] !== container) {
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
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
  }, []);

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
  driveStatus = null,
  driveAuthBusy = false,
  onOpenDrivePicker,
  onConnectGoogleDrive,
  onDisconnectGoogleDrive,
  onUpdateField,
  onClose,
  onSubmit,
}) {
  if (!modal) return null;

  const isDelete = modal.startsWith('delete-');
  const selectedDriveDocs = Array.isArray(form.selected_drive_docs) ? form.selected_drive_docs : [];

  return (
    <Modal key={modal} title={MODAL_TITLES[modal] || 'Formulario'} onClose={onClose}>
      <form onSubmit={onSubmit} className="form-grid">
        {error && <Notice kind="error">{error}</Notice>}

        {(modal === 'new-person' || modal === 'edit-person') && (() => {
          const rawFolderInput = (form.drive_folder_id || '').trim();
          const extractedFolderId = rawFolderInput ? extractGoogleFolderId(rawFolderInput) : '';
          return (
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

              {onOpenDrivePicker && (
                <div className="drive-inline-picker">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onOpenDrivePicker({
                      mode: 'folder',
                      multiple: false,
                      title: 'Elegir carpeta del usuario en Google Drive',
                      target: 'person-folder',
                    })}
                  >
                    ☁ Elegir carpeta desde Google Drive
                  </button>
                  {form.drive_folder_name && extractedFolderId && (
                    <span className="status-badge badge-ok">
                      Carpeta: {form.drive_folder_name}
                    </span>
                  )}
                </div>
              )}

              <label>
                Carpeta en Google Drive (URL o ID, opcional)
                <input
                  maxLength={500}
                  placeholder="Ej.: https://drive.google.com/drive/folders/... o 1AbCdEf..."
                  value={form.drive_folder_id || ''}
                  onChange={(e) => {
                    onUpdateField('drive_folder_id', e.target.value);
                    if (!e.target.value.trim()) onUpdateField('drive_folder_name', '');
                  }}
                />
              </label>
              {rawFolderInput ? (
                extractedFolderId ? (
                  <div className="id-preview-row" aria-live="polite">
                    <span>
                      ID detectado para usuario: <code>{extractedFolderId}</code>
                    </span>
                    {rawFolderInput !== extractedFolderId && (
                      <button
                        type="button"
                        className="btn btn-tiny"
                        onClick={() => onUpdateField('drive_folder_id', extractedFolderId)}
                      >
                        Dejar solo ID
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="form-hint form-hint-warn" aria-live="polite">
                    Enlace o ID no reconocido. Pega https://drive.google.com/drive/folders/… o el ID limpio.
                  </p>
                )
              ) : (
                <p className="form-hint">
                  Al elegir o vincular una carpeta privada de Google Drive, sus bitácoras se sincronizarán automáticamente sin necesidad de hacer el enlace público.
                </p>
              )}
            </>
          );
        })()}

        {modal === 'delete-person' && (
          <>
            <Notice kind="warn">
              ¿Confirmas eliminar al usuario <strong>{form.codigo} ({form.nombre})</strong>?
              Se eliminarán sus fichas de bitácora y comentarios en la plataforma (los archivos en Google Drive no se borran).
            </Notice>
          </>
        )}

        {(modal === 'new-log' || modal === 'edit-log') && (() => {
          const hasSelectedDriveDocs = modal === 'new-log' && selectedDriveDocs.length > 0;
          const hasManualUrl = Boolean((form.url_docs || '').trim()) || hasSelectedDriveDocs;
          const autoCreateDrive = modal === 'new-log' && form.crear_en_drive !== false && !hasManualUrl;
          const tituloPreview = (form.titulo || '').trim() || 'Bitácora';

          return (
            <>
              {onOpenDrivePicker && (
                <div className="drive-inline-picker">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onOpenDrivePicker({
                      mode: 'docs',
                      multiple: modal === 'new-log',
                      title: modal === 'new-log'
                        ? 'Seleccionar bitácoras desde Google Drive'
                        : 'Seleccionar documento desde Google Drive',
                      target: modal,
                    })}
                  >
                    ☁ Seleccionar desde Google Drive
                  </button>
                  <span className="muted">Acceso privado con tu sesión Google</span>
                </div>
              )}

              {hasSelectedDriveDocs ? (
                <div className="selected-drive-docs-box" aria-live="polite">
                  <div className="panel-heading-inline">
                    <strong>
                      {selectedDriveDocs.length}{' '}
                      {selectedDriveDocs.length === 1 ? 'bitácora seleccionada' : 'bitácoras seleccionadas'} de Drive
                    </strong>
                    <button
                      type="button"
                      className="btn btn-tiny"
                      onClick={() => onUpdateField('selected_drive_docs', [])}
                    >
                      Quitar selección
                    </button>
                  </div>
                  <ul className="compact-list">
                    {selectedDriveDocs.map((doc) => (
                      <li key={doc.id}>
                        <strong>{doc.name}</strong>
                        <small>Google Docs privado · sincronizado al guardar</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <label>
                    Nombre de la bitácora
                    <input
                      data-autofocus="true"
                      maxLength={160}
                      required
                      placeholder="Ej.: Bitácora mayo o Seguimiento"
                      value={form.titulo || ''}
                      onChange={(e) => onUpdateField('titulo', e.target.value)}
                    />
                  </label>
                  {modal === 'new-log' && (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={autoCreateDrive}
                        disabled={hasManualUrl}
                        onChange={(e) => onUpdateField('crear_en_drive', e.target.checked)}
                      />
                      <span>
                        Crear carpeta y Google Doc en Drive automáticamente ({tituloPreview})
                      </span>
                    </label>
                  )}
                  <label>
                    {modal === 'new-log' ? 'Enlace de Google Docs existente (opcional)' : 'Enlace de Google Docs (opcional)'}
                    <input
                      type="url"
                      maxLength={500}
                      placeholder="https://docs.google.com/document/d/.../edit"
                      value={form.url_docs || ''}
                      onChange={(e) => onUpdateField('url_docs', e.target.value)}
                    />
                  </label>
                  <p className="form-hint">
                    {hasManualUrl
                      ? 'Se vinculará el Google Doc existente que pegaste (sin crear archivos nuevos en Drive).'
                      : autoCreateDrive
                        ? `Se creará en Drive la carpeta "${tituloPreview}" y dentro un Google Doc con el mismo nombre, quedando sincronizado automáticamente con este usuario.`
                        : 'El ID del documento se extrae automáticamente para resúmenes IA y detección de cambios.'}
                  </p>
                </>
              )}
            </>
          );
        })()}

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

            {onConnectGoogleDrive && (
              <div className="sync-summary-box">
                <div className="panel-heading-inline">
                  <strong>Conexión con Google Drive</strong>
                  {driveStatus?.conectado ? (
                    <span className="status-badge badge-ok">● Conectado</span>
                  ) : driveStatus?.status === 'requiere_reconexion' ? (
                    <span className="status-badge badge-warn">! Requiere reconexión</span>
                  ) : (
                    <span className="status-badge badge-muted">○ No conectado</span>
                  )}
                </div>
                <p className="muted">
                  {driveStatus?.conectado
                    ? `Cuenta vinculada: ${driveStatus.google_email || form.email}${driveStatus.tiene_refresh_token ? ' (acceso continuo activo)' : ' (solo sesión temporal; reconecta para acceso continuo)'}.`
                    : 'Conecta tu cuenta Google para seleccionar y leer carpetas o bitácoras privadas sin hacer los enlaces públicos.'}
                </p>
                <div className="detail-actions">
                  <button
                    type="button"
                    className="btn btn-tiny btn-secondary"
                    disabled={driveAuthBusy}
                    onClick={() => onConnectGoogleDrive({ set_institutional: false })}
                  >
                    {driveStatus?.conectado
                      ? (driveStatus.tiene_refresh_token ? 'Reconectar Google Drive' : 'Autorizar acceso continuo')
                      : 'Conectar Google Drive'}
                  </button>
                  {driveStatus?.conectado && onDisconnectGoogleDrive && (
                    <button
                      type="button"
                      className="btn btn-tiny btn-danger-outline"
                      disabled={driveAuthBusy}
                      onClick={onDisconnectGoogleDrive}
                    >
                      Desconectar
                    </button>
                  )}
                </div>
              </div>
            )}

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
                : modal === 'new-log' && selectedDriveDocs.length > 0
                  ? `Vincular ${selectedDriveDocs.length} ${selectedDriveDocs.length === 1 ? 'bitácora' : 'bitácoras'}`
                  : 'Guardar'
          }
        />
      </form>
    </Modal>
  );
}
