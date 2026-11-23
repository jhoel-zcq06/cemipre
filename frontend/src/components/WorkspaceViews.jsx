import { useState } from 'react';
import { extractDriveResourceInfo } from '../api.js';
import {
  FolderSourceBadge,
  Notice,
  Pagination,
  SummaryPanel,
  SyncStatusBadge,
  formatDate,
  formatDateTime,
} from './SharedUI.jsx';
export { CalendarioView } from './CalendarView.jsx';

export function UsuariosView({
  people,
  peopleMeta,
  search,
  onlyFavorites,
  selectedId,
  person,
  favoriteIdsSet,
  comments,
  summary,
  summaryLoading,
  isAdmin,
  currentUserId,
  onSearchChange,
  onToggleOnlyFavorites,
  onPageChange,
  onSelectPerson,
  onToggleFavorite,
  onOpenModal,
  onOpenDrivePicker,
  onGenerateSummary,
  onAddComment,
  onDeleteComment,
}) {
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

  async function submitComment(event) {
    event.preventDefault();
    if (!commentText.trim() || !person) return;
    setCommentBusy(true);
    const ok = await onAddComment({ persona_id: person.id, contenido: commentText.trim() });
    if (ok) setCommentText('');
    setCommentBusy(false);
  }

  const isFav = person ? favoriteIdsSet.has(person.id) : false;

  return (
    <div className="content-grid">
      <section className="panel people-panel" aria-label="Lista de usuarios">
        <div className="panel-title">
          <h2>Usuarios</h2>
          <span className="count-pill">{peopleMeta.total}</span>
        </div>

        <label className="search-field">
          <span className="sr-only">Buscar usuario por nombre o código</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar por nombre o código…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>

        <div className="filter-bar">
          <button
            type="button"
            className={`btn btn-tiny ${onlyFavorites ? 'btn-primary' : ''}`}
            aria-pressed={onlyFavorites}
            onClick={onToggleOnlyFavorites}
          >
            {onlyFavorites ? '★ Mostrando favoritos' : '☆ Solo favoritos'}
          </button>
        </div>

        <div className="people-list">
          {people.length === 0 ? (
            <p className="muted padded">Sin resultados. Puedes limpiar el filtro o crear un usuario.</p>
          ) : (
            people.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`person-row ${selectedId === p.id ? 'selected' : ''}`}
                onClick={() => onSelectPerson(p.id)}
              >
                <span className="person-avatar">{p.codigo.slice(-2)}</span>
                <span className="person-info">
                  <strong>
                    {favoriteIdsSet.has(p.id) ? '★ ' : ''}
                    {p.nombre}
                  </strong>
                  <small>{p.codigo} · {p.total_bitacoras} bitácoras</small>
                </span>
                <span className="chevron" aria-hidden="true">›</span>
              </button>
            ))
          )}
        </div>

        <Pagination
          page={peopleMeta.page}
          totalPages={peopleMeta.totalPages}
          totalItems={peopleMeta.total}
          onPageChange={onPageChange}
          label="Paginación de usuarios"
        />
      </section>

      <section className="panel detail-panel" aria-label="Detalle de bitácoras">
        {!person ? (
          <div className="empty-state">Selecciona un usuario para ver sus bitácoras.</div>
        ) : (
          <>
            <div className="detail-heading">
              <div className="title-with-icon">
                <div className="detail-avatar">{person.codigo.slice(-2)}</div>
                <div>
                  <p className="eyebrow">
                    {person.codigo}
                    {person.drive_folder_name
                      ? ` · Drive: ${person.drive_folder_name}`
                      : person.drive_folder_id
                        ? ' · Drive vinculado'
                        : ''}
                  </p>
                  <h2>{person.nombre}</h2>
                  <p className="muted">{person.bitacoras.length} bitácoras registradas</p>
                </div>
              </div>
              <div className="detail-actions">
                <button
                  className={`btn btn-tiny ${isFav ? 'btn-primary' : ''}`}
                  type="button"
                  aria-pressed={isFav}
                  onClick={() => onToggleFavorite(person.id, isFav)}
                >
                  {isFav ? '★ Favorito' : '☆ Favorito'}
                </button>
                <button
                  className="btn btn-tiny"
                  type="button"
                  onClick={() => onOpenModal('edit-person', person)}
                >
                  Editar
                </button>
                {isAdmin && (
                  <button
                    className="btn btn-tiny btn-danger-outline"
                    type="button"
                    onClick={() => onOpenModal('delete-person', person)}
                  >
                    Eliminar
                  </button>
                )}
                {onOpenDrivePicker && (
                  <button
                    className="btn btn-tiny btn-outline"
                    type="button"
                    onClick={() => onOpenDrivePicker({
                      mode: 'docs',
                      multiple: true,
                      title: `Seleccionar bitácoras en Drive para ${person.codigo}`,
                      target: 'direct-add-logs',
                      context: { persona_id: person.id },
                    })}
                  >
                    ☁ Elegir de Drive
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => onOpenModal('new-log', { persona_id: person.id, crear_en_drive: true })}
                >
                  + Agregar bitácora
                </button>
              </div>
            </div>

            <div className="section-heading">
              <h3>Documentos y registros</h3>
              <span>{person.bitacoras.length} documentos</span>
            </div>

            {person.bitacoras.length === 0 ? (
              <div className="empty-state">Este usuario aún no tiene bitácoras.</div>
            ) : (
              <div className="logs-list">
                {person.bitacoras.map((b) => (
                  <article className="log-row" key={b.id}>
                    <span className="doc-icon" aria-hidden="true">≡</span>
                    <div className="log-body">
                      <strong>{b.titulo}</strong>
                      <small>
                        Actualización: {formatDate(b.drive_modified_time || b.actualizada)}
                      </small>
                      <div className="log-badges">
                        <SyncStatusBadge estado={b.estado_sync} urlDocs={b.url_docs} />
                        <FolderSourceBadge path={b.drive_folder_path} />
                      </div>
                    </div>
                    <div className="log-actions">
                      <button
                        className="btn btn-tiny"
                        type="button"
                        onClick={() => onOpenModal('edit-log', b)}
                      >
                        Configurar
                      </button>
                      <button
                        className="btn btn-tiny btn-danger-outline"
                        type="button"
                        onClick={() => onOpenModal('delete-log', b)}
                      >
                        Eliminar
                      </button>
                      {b.url_docs && (
                        <a
                          className="btn btn-tiny btn-outline"
                          target="_blank"
                          rel="noopener noreferrer"
                          href={b.url_docs}
                        >
                          Abrir ↗
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            <SummaryPanel
              summary={summary}
              loading={summaryLoading}
              onGenerate={onGenerateSummary}
            />

            <div className="comments-section">
              <div className="section-heading">
                <h3>Notas internas del equipo</h3>
                <span>{comments.length} notas</span>
              </div>

              <form onSubmit={submitComment} className="comment-form">
                <label className="sr-only" htmlFor="nuevo-comentario">
                  Agregar nota interna de coordinación
                </label>
                <textarea
                  id="nuevo-comentario"
                  rows={2}
                  maxLength={1500}
                  placeholder="Escribe una nota interna para el equipo…"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled={commentBusy || !commentText.trim()}
                >
                  {commentBusy ? 'Guardando…' : 'Publicar nota'}
                </button>
              </form>

              {comments.length === 0 ? (
                <p className="muted padded">Sin notas internas registradas para este usuario.</p>
              ) : (
                <div className="comments-list">
                  {comments.map((c) => (
                    <article key={c.id} className="comment-item">
                      <div className="comment-header">
                        <strong>{c.autor_nombre || 'Trabajador CEMIPRE'}</strong>
                        <small>{formatDateTime(c.creado)}</small>
                      </div>
                      <p>{c.contenido}</p>
                      {(isAdmin || c.autor_id === currentUserId) && (
                        <button
                          type="button"
                          className="inline-button muted"
                          onClick={() => onDeleteComment(c.id)}
                        >
                          Eliminar nota
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function BitacorasView({
  logs,
  logsMeta,
  search,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onPageChange,
  onOpenUser,
  onOpenModal,
}) {
  return (
    <section className="panel wide-panel" aria-label="Directorio global de bitácoras">
      <div className="panel-title">
        <h2>Todas las bitácoras</h2>
        <span className="count-pill">{logsMeta.total}</span>
      </div>

      <div className="toolbar-row">
        <label className="search-field toolbar-search">
          <span className="sr-only">Buscar por título o carpeta de bitácora</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar por título o carpeta…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>

        <div className="filter-pills" role="group" aria-label="Filtrar por estado">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'linked', label: 'Vinculadas' },
            { id: 'unlinked', label: 'Sin enlace' },
            { id: 'errors', label: 'Con alerta Drive' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              className={`btn btn-tiny ${statusFilter === f.id ? 'btn-primary' : ''}`}
              aria-pressed={statusFilter === f.id}
              onClick={() => onStatusFilterChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state">No hay bitácoras que coincidan con el filtro.</div>
      ) : (
        <div className="logs-list">
          {logs.map((b) => (
            <article className="log-row" key={b.id}>
              <span className="doc-icon" aria-hidden="true">≡</span>
              <div className="log-body">
                <strong>
                  {b.personas ? `${b.personas.codigo} · ` : ''}
                  {b.titulo}
                </strong>
                <small>
                  {b.personas?.nombre || `Persona #${b.persona_id}`} · Actualización:{' '}
                  {formatDate(b.drive_modified_time || b.actualizada)}
                </small>
                <div className="log-badges">
                  <SyncStatusBadge estado={b.estado_sync} urlDocs={b.url_docs} />
                  <FolderSourceBadge path={b.drive_folder_path} />
                </div>
              </div>
              <div className="log-actions">
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => onOpenUser(b.persona_id)}
                >
                  Ver ficha
                </button>
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => onOpenModal('edit-log', b)}
                >
                  Configurar
                </button>
                <button
                  type="button"
                  className="btn btn-tiny btn-danger-outline"
                  onClick={() => onOpenModal('delete-log', b)}
                >
                  Eliminar
                </button>
                {b.url_docs && (
                  <a
                    className="btn btn-tiny btn-outline"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={b.url_docs}
                  >
                    Abrir ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Pagination
        page={logsMeta.page}
        totalPages={logsMeta.totalPages}
        totalItems={logsMeta.total}
        onPageChange={onPageChange}
        label="Paginación de bitácoras"
      />
    </section>
  );
}

export function ActividadView({ changes, activityMeta, onPageChange }) {
  return (
    <section className="panel wide-panel" aria-label="Registro de actividad y auditoría">
      <div className="panel-title">
        <h2>Registro de actividad</h2>
        <span className="count-pill">{activityMeta.total}</span>
      </div>
      <p className="muted">
        Las ediciones hechas directamente en Google Docs aparecen en <strong>Avisos</strong>.
      </p>

      {changes.length === 0 ? (
        <div className="empty-state">Todavía no hay movimientos registrados.</div>
      ) : (
        <div className="activity-list">
          {changes.map((item) => (
            <div className="activity-row" key={item.id}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <strong>{item.descripcion}</strong>
                <small>
                  {item.actor_nombre} · {formatDateTime(item.fecha)}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={activityMeta.page}
        totalPages={activityMeta.totalPages}
        totalItems={activityMeta.total}
        onPageChange={onPageChange}
        label="Paginación de actividad"
      />
    </section>
  );
}

const NOTIF_LABEL = {
  enviada: { text: 'Enviada', cls: 'badge-ok' },
  omitida: { text: 'Agrupada / Omitida', cls: 'badge-warn' },
  error: { text: 'Error de envío', cls: 'badge-error' },
};

export function AvisosCorreoView({
  notifications,
  notifMeta,
  perfil,
  onPageChange,
  onRefresh,
  onOpenProfileSettings,
}) {
  return (
    <section className="panel wide-panel" aria-label="Historial de avisos por correo">
      <div className="panel-title-between">
        <div className="panel-title">
          <h2>Avisos por correo electrónico</h2>
          <span className="count-pill">{notifMeta.total}</span>
        </div>
        <div className="detail-actions">
          {onRefresh && (
            <button type="button" className="btn btn-tiny" onClick={onRefresh}>
              Actualizar
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onOpenProfileSettings}>
            {perfil?.recibir_notificaciones ? '● Avisos activos en mi perfil' : '○ Avisos silenciados en mi perfil'}
          </button>
        </div>
      </div>

      <p className="muted">
        Correos enviados al detectar cambios en bitácoras.
      </p>

      {notifications.length === 0 ? (
        <div className="empty-state">Aún no se registran notificaciones enviadas.</div>
      ) : (
        <div className="logs-list">
          {notifications.map((n) => {
            const meta = NOTIF_LABEL[n.estado] || { text: n.estado, cls: 'badge-muted' };
            return (
              <article key={n.id} className="log-row">
                <span className="doc-icon" aria-hidden="true">✉</span>
                <div className="log-body">
                  <strong>
                    {n.personas ? `${n.personas.codigo} · ` : ''}
                    {n.bitacoras?.titulo || `Bitácora #${n.bitacora_id || '-'}`}
                  </strong>
                  <small>
                    Para: {n.destinatario_email} · {formatDateTime(n.enviada_en)}
                  </small>
                  {n.detalle_error && <small className="muted">{n.detalle_error}</small>}
                </div>
                <span className={`status-badge ${meta.cls}`}>{meta.text}</span>
              </article>
            );
          })}
        </div>
      )}

      <Pagination
        page={notifMeta.page}
        totalPages={notifMeta.totalPages}
        totalItems={notifMeta.total}
        onPageChange={onPageChange}
        label="Paginación de notificaciones"
      />
    </section>
  );
}

export function CarpetasDriveView({
  syncState,
  syncResult,
  syncBusy,
  people,
  isAdmin = false,
  driveStatus = null,
  driveAuthBusy = false,
  onSyncDrive,
  onOpenUser,
  onOpenModal,
  onConnectGoogleDrive,
  onDisconnectGoogleDrive,
  onSetInstitutionalDrive,
  onToggleAutoSync,
  onSaveRootFolder,
  onOpenDrivePicker,
}) {
  const [rootFolderId, setRootFolderId] = useState('');
  const [extractorInput, setExtractorInput] = useState('');
  const [copiedId, setCopiedId] = useState(false);

  const extractedInfo = extractDriveResourceInfo(extractorInput);
  const autoSyncActive = syncState?.auto_sync_enabled !== false;
  const institutionalConnected = Boolean(driveStatus?.institucional?.conectado)
    || syncState?.connection_status === 'conectado';
  const institutionalNeedsReconnect = driveStatus?.institucional?.status === 'requiere_reconexion'
    || syncState?.connection_status === 'requiere_reconexion';
  const institutionalEmail = driveStatus?.institucional?.google_email || syncState?.institutional_email || '';

  async function handleCopyId() {
    if (!extractedInfo.id) return;
    try {
      await navigator.clipboard?.writeText(extractedInfo.id);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 2000);
    } catch {
      setCopiedId(false);
    }
  }

  return (
    <section className="panel wide-panel" aria-label="Configuración de carpetas de Google Drive">
      <div className="panel-title-between">
        <div className="panel-title">
          <h2>Google Drive</h2>
          <span className={`status-badge ${autoSyncActive ? 'badge-ok' : 'badge-warn'}`}>
            {autoSyncActive ? '● Sincronización activa' : '○ Sincronización pausada'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={syncBusy}
          aria-busy={syncBusy}
          onClick={() => onSyncDrive({ root_folder_id: rootFolderId.trim() || undefined })}
          title="Sincronizar carpetas y bitácoras ahora"
        >
          {syncBusy ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      </div>

      {institutionalNeedsReconnect && (
        <Notice kind="warn">
          La cuenta de Google Drive del equipo requiere reconexión.{' '}
          {isAdmin && onConnectGoogleDrive && (
            <button
              type="button"
              className="inline-button"
              disabled={driveAuthBusy}
              onClick={() => onConnectGoogleDrive({ set_institutional: true })}
            >
              Reconectar cuenta
            </button>
          )}
        </Notice>
      )}

      <div className="drive-cards-grid">
        <article className="sync-summary-box drive-connection-card">
          <div className="panel-heading-inline">
            <h3>Tu cuenta de Google</h3>
            {driveStatus?.conectado ? (
              <span className="status-badge badge-ok">● Conectada</span>
            ) : driveStatus?.status === 'requiere_reconexion' ? (
              <span className="status-badge badge-warn">! Reconectar</span>
            ) : (
              <span className="status-badge badge-muted">○ Sin conectar</span>
            )}
          </div>
          <p className="muted">
            {driveStatus?.conectado
              ? `Conectada como ${driveStatus.google_email || 'cuenta Google'}.`
              : 'Conecta tu cuenta de Google para seleccionar carpetas y documentos.'}
          </p>
          {driveStatus?.conectado && !driveStatus?.tiene_refresh_token && (
            <p className="form-hint form-hint-warn">
              Tu sesión de Google vence en 1 hora. Pulsa «Renovar conexión» para mantenerla activa.
            </p>
          )}
          <div className="detail-actions">
            {onConnectGoogleDrive && (
              <button
                type="button"
                className="btn btn-primary btn-tiny-fill"
                disabled={driveAuthBusy}
                onClick={() => onConnectGoogleDrive({ set_institutional: false })}
              >
                {driveStatus?.conectado
                  ? (driveStatus.tiene_refresh_token ? 'Reconectar' : 'Renovar conexión')
                  : 'Conectar Google Drive'}
              </button>
            )}
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
        </article>

        <article className="sync-summary-box drive-connection-card">
          <div className="panel-heading-inline">
            <h3>Cuenta del equipo</h3>
            {institutionalConnected ? (
              <span className="status-badge badge-ok">● Activa</span>
            ) : institutionalNeedsReconnect ? (
              <span className="status-badge badge-warn">! Requiere reconexión</span>
            ) : (
              <span className="status-badge badge-muted">○ Pendiente</span>
            )}
          </div>
          <p className="muted">
            {institutionalEmail
              ? `Cuenta activa: ${institutionalEmail}.`
              : syncState?.auth_mode === 'service_account'
                ? 'Usando conexión de respaldo. Un administrador puede conectar la cuenta Google del equipo.'
                : 'Un administrador debe conectar la cuenta de Google del equipo.'}
          </p>
          {isAdmin && (
            <div className="detail-actions">
              {onConnectGoogleDrive && (
                <button
                  type="button"
                  className="btn btn-secondary btn-tiny-fill"
                  disabled={driveAuthBusy}
                  onClick={() => onConnectGoogleDrive({ set_institutional: true })}
                >
                  {institutionalEmail ? 'Cambiar cuenta del equipo' : 'Conectar cuenta del equipo'}
                </button>
              )}
              {driveStatus?.conectado
                && driveStatus?.tiene_refresh_token
                && !driveStatus?.es_institucional
                && onSetInstitutionalDrive && (
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={driveAuthBusy}
                    onClick={onSetInstitutionalDrive}
                  >
                    Usar mi cuenta
                  </button>
              )}
              {onToggleAutoSync && (
                <button
                  type="button"
                  className="btn btn-tiny"
                  disabled={driveAuthBusy}
                  onClick={() => onToggleAutoSync(!autoSyncActive)}
                >
                  {autoSyncActive ? 'Pausar sincronización' : 'Activar sincronización'}
                </button>
              )}
            </div>
          )}
        </article>
      </div>

      <div className="sync-summary-box">
        <div className="panel-heading-inline">
          <h3>Carpeta raíz</h3>
          {isAdmin && onOpenDrivePicker && (
            <button
              type="button"
              className="btn btn-secondary btn-tiny-fill"
              onClick={() => onOpenDrivePicker({
                mode: 'folder',
                multiple: false,
                title: 'Elegir carpeta raíz de CEMIPRE en Google Drive',
                target: 'root-folder',
              })}
            >
              ☁ Elegir carpeta raíz
            </button>
          )}
        </div>
        <p className="muted">
          {syncState?.root_folder_id
            ? (
              <>
                Carpeta seleccionada:{' '}
                <strong>{syncState.root_folder_name || syncState.root_folder_id}</strong>.
              </>
            )
            : 'No hay carpeta raíz seleccionada.'}
        </p>
        {isAdmin && onSaveRootFolder && (
          <div className="drive-root-manual-row">
            <label className="sync-folder-input">
              <span>Pegar enlace o ID de carpeta raíz</span>
              <input
                type="text"
                placeholder="Ej.: https://drive.google.com/drive/folders/... o 1AbCdEf..."
                value={rootFolderId}
                onChange={(e) => setRootFolderId(e.target.value)}
              />
            </label>
            <div className="detail-actions">
              <button
                type="button"
                className="btn btn-tiny btn-primary"
                disabled={driveAuthBusy || !rootFolderId.trim()}
                onClick={async () => {
                  const ok = await onSaveRootFolder({ root_folder_id: rootFolderId.trim() });
                  if (ok) setRootFolderId('');
                }}
              >
                Guardar carpeta raíz
              </button>
              {syncState?.root_folder_id && (
                <button
                  type="button"
                  className="btn btn-tiny btn-danger-outline"
                  disabled={driveAuthBusy}
                  onClick={() => onSaveRootFolder({ root_folder_id: '', root_folder_name: '' })}
                >
                  Quitar carpeta raíz
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {syncState && (
        <div className="sync-summary-box">
          <strong>Última sincronización:</strong>{' '}
          <span>
            {syncState.ultima_sincronizacion
              ? formatDateTime(syncState.ultima_sincronizacion)
              : 'Aún no realizada'}
          </span>
          {syncState.ultimo_estado && <p className="muted">{syncState.ultimo_estado}</p>}
        </div>
      )}

      {syncResult && (
        <div className="sync-report" aria-live="polite">
          <h3>Resultado de la sincronización</h3>
          <div className="stats stats-4">
            <div className="stat-card"><span>Personas procesadas</span><strong>{syncResult.personas_procesadas}</strong></div>
            <div className="stat-card"><span>Docs nuevos</span><strong>{syncResult.nuevas_bitacoras}</strong></div>
            <div className="stat-card"><span>Bitácoras verificadas</span><strong>{syncResult.bitacoras_actualizadas}</strong></div>
            <div className="stat-card"><span>Alertas permisos/faltantes</span><strong>{(syncResult.errores_permisos || 0) + (syncResult.no_encontradas || 0)}</strong></div>
          </div>
          {Array.isArray(syncResult.detalles) && syncResult.detalles.length > 0 && (
            <ul className="sources-grid">
              {syncResult.detalles.map((d, idx) => (
                <li key={`det-${idx}`}>
                  <strong>[{d.tipo}]</strong> {d.mensaje}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="section-heading">
        <h3>Carpetas por usuario</h3>
        <span>{people.length} usuarios</span>
      </div>

      <div className="logs-list">
        {people.map((p) => (
          <article key={p.id} className="log-row">
            <span className="doc-icon" aria-hidden="true">▤</span>
            <div className="log-body">
              <strong>{p.codigo} · {p.nombre}</strong>
              <small>
                {p.drive_folder_id
                  ? `${p.drive_folder_name ? `${p.drive_folder_name} · ` : ''}ID: ${p.drive_folder_id}`
                  : 'Sin carpeta asignada'}
              </small>
            </div>
            <div className="log-actions">
              {onOpenDrivePicker && (
                <button
                  type="button"
                  className="btn btn-tiny btn-secondary"
                  onClick={() => onOpenDrivePicker({
                    mode: 'folder',
                    multiple: false,
                    title: `Elegir carpeta Drive para ${p.codigo}`,
                    target: 'assign-user-folder',
                    context: p,
                  })}
                >
                  ☁ Elegir carpeta
                </button>
              )}
              <button
                type="button"
                className="btn btn-tiny btn-outline"
                onClick={() => onOpenUser(p.id)}
              >
                Ver bitácoras
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="id-extractor-box">
        <label className="sync-folder-input" htmlFor="drive-id-extractor-input">
          <span>Extractor rápido de ID de Google Drive</span>
          <input
            id="drive-id-extractor-input"
            type="text"
            placeholder="https://drive.google.com/drive/folders/... o enlace de Google Docs"
            value={extractorInput}
            onChange={(e) => {
              setExtractorInput(e.target.value);
              setCopiedId(false);
            }}
          />
        </label>

        {extractorInput.trim() !== '' && (
          extractedInfo.valid && extractedInfo.id ? (
            <div className="id-extractor-result" aria-live="polite">
              <div className="id-extractor-meta">
                <span className="status-badge badge-ok">{extractedInfo.label}</span>
                <code className="extracted-id-code">{extractedInfo.id}</code>
              </div>
              <div className="detail-actions">
                <button type="button" className="btn btn-tiny btn-primary" onClick={handleCopyId}>
                  {copiedId ? 'Copiado ✓' : 'Copiar ID'}
                </button>
                {extractedInfo.kind !== 'doc' && onOpenModal && (
                  <button
                    type="button"
                    className="btn btn-tiny btn-secondary"
                    onClick={() => onOpenModal('new-person', { drive_folder_id: extractedInfo.id })}
                  >
                    Crear usuario con este ID
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => {
                    setExtractorInput('');
                    setCopiedId(false);
                  }}
                >
                  Limpiar
                </button>
              </div>
            </div>
          ) : (
            <p className="form-hint form-hint-warn" aria-live="polite">
              {extractedInfo.error}
            </p>
          )
        )}
      </div>
    </section>
  );
}

export function AdministracionView({
  profiles,
  whitelist,
  currentUserId,
  canManageAdmins = false,
  onChangeRole,
  onAddWhitelist,
  onRemoveWhitelist,
}) {
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('trabajador');
  const [busy, setBusy] = useState(false);

  async function handleWhitelistSubmit(event) {
    event.preventDefault();
    if (!newEmail.trim()) return;
    setBusy(true);
    const effectiveRole = canManageAdmins ? newRole : 'trabajador';
    const ok = await onAddWhitelist({ email: newEmail.trim(), rol: effectiveRole });
    if (ok) setNewEmail('');
    setBusy(false);
  }

  return (
    <div className="dashboard-stack">
      <section className="panel wide-panel" aria-label="Gestión de cuentas y roles">
        <div className="panel-title">
          <h2>Aprobación de trabajadores y roles</h2>
          <span className="count-pill">{profiles.length}</span>
        </div>
        <p className="muted">
          Las cuentas nuevas inician como pendientes hasta que un administrador cambie su rol.
        </p>

        <div className="logs-list">
          {profiles.map((prof) => {
            const isSelf = prof.id === currentUserId;
            const isLockedAdmin = prof.rol === 'admin' && (isSelf || !canManageAdmins);
            return (
              <article key={prof.id} className="log-row">
                <span className="doc-icon" aria-hidden="true">◎</span>
                <div className="log-body">
                  <strong>{prof.nombre || prof.email}</strong>
                  <small>
                    {prof.email} · Notificaciones: {prof.recibir_notificaciones ? 'Activas' : 'Silenciadas'}
                  </small>
                </div>
                <div className="log-actions">
                  {isLockedAdmin ? (
                    <span className="status-badge badge-muted">admin</span>
                  ) : (
                    <>
                      <label className="sr-only" htmlFor={`rol-${prof.id}`}>
                        Rol para {prof.email}
                      </label>
                      <select
                        id={`rol-${prof.id}`}
                        className="role-select"
                        value={prof.rol}
                        disabled={isSelf}
                        onChange={(e) => onChangeRole(prof.id, e.target.value)}
                      >
                        <option value="pendiente">pendiente</option>
                        <option value="trabajador">trabajador</option>
                        {canManageAdmins && <option value="admin">admin</option>}
                      </select>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel wide-panel" aria-label="Correos autorizados">
        <div className="panel-title">
          <h2>Correos autorizados</h2>
          <span className="count-pill">{whitelist.length}</span>
        </div>
        <p className="muted">
          Los correos en esta lista se aprueban automáticamente al registrarse.
        </p>

        <form onSubmit={handleWhitelistSubmit} className="whitelist-form">
          <input
            type="email"
            required
            placeholder="correo@cemipre.cl"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <select
            value={canManageAdmins ? newRole : 'trabajador'}
            onChange={(e) => setNewRole(e.target.value)}
            aria-label="Rol asignado"
          >
            <option value="trabajador">trabajador</option>
            {canManageAdmins && <option value="admin">admin</option>}
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Agregar correo
          </button>
        </form>

        {whitelist.length > 0 && (
          <div className="logs-list">
            {whitelist.map((item) => (
              <article key={item.email} className="log-row">
                <div className="log-body">
                  <strong>{item.email}</strong>
                  <small>Rol: {item.rol}</small>
                </div>
                {item.rol === 'admin' && !canManageAdmins ? (
                  <span className="status-badge badge-muted">admin</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-tiny btn-danger-outline"
                    onClick={() => onRemoveWhitelist(item.email)}
                  >
                    Quitar
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
