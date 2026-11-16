import { useState } from 'react';
import { extractDriveResourceInfo } from '../api.js';
import {
  Notice,
  Pagination,
  SummaryPanel,
  SyncStatusBadge,
  formatDate,
  formatDateTime,
  toDateTimeLocalInput,
} from './SharedUI.jsx';

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
                    {person.drive_folder_id ? ' · Drive vinculado' : ''}
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
                  placeholder="Anota coordinación interna del equipo (las notas clínicas oficiales siguen yendo en Google Docs)…"
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
          <span className="sr-only">Buscar por título de bitácora</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar por título de bitácora…"
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

export function CalendarioView({ events, onOpenModal }) {
  return (
    <section className="panel wide-panel" aria-label="Calendario compartido del equipo">
      <div className="panel-title">
        <h2>Eventos programados</h2>
        <span className="count-pill">{events.length}</span>
      </div>
      <p className="muted">
        Agenda interna compartida en Supabase (zona horaria América/Santiago).
      </p>

      {events.length === 0 ? (
        <div className="empty-state">No hay eventos. Crea el primero para comenzar.</div>
      ) : (
        <div className="event-list">
          {events.map((event) => (
            <article className="event-row" key={event.id}>
              <div className="event-date">
                <strong>
                  {new Date(event.inicio).toLocaleDateString('es-CL', {
                    timeZone: 'America/Santiago',
                    day: '2-digit',
                  })}
                </strong>
                <span>
                  {new Date(event.inicio).toLocaleDateString('es-CL', {
                    timeZone: 'America/Santiago',
                    month: 'short',
                  })}
                </span>
              </div>
              <div className="event-body">
                <h3>{event.titulo}</h3>
                <p>{formatDateTime(event.inicio)} – {formatDateTime(event.fin)}</p>
                <p>
                  {event.responsable}
                  {event.descripcion ? ` · ${event.descripcion}` : ''}
                </p>
              </div>
              <div className="log-actions">
                <button
                  className="btn btn-tiny"
                  type="button"
                  onClick={() =>
                    onOpenModal('edit-event', {
                      ...event,
                      inicio: toDateTimeLocalInput(event.inicio),
                      fin: toDateTimeLocalInput(event.fin),
                    })
                  }
                >
                  Editar
                </button>
                <button
                  className="btn btn-tiny btn-danger-outline"
                  type="button"
                  onClick={() => onOpenModal('delete-event', event)}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
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
      <Notice>
        Auditoría de cambios en usuarios, bitácoras, eventos, sincronizaciones y generación de resúmenes IA.
        Los cambios realizados directamente dentro de Google Docs se detectan y muestran en <strong>Avisos</strong>.
      </Notice>

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

      <Notice>
        La función programada <code>notificar-cambios</code> revisa periódicamente Google Drive Changes API,
        agrupa autoguardados seguidos y envía correos <strong>sin contenido clínico sensible</strong>.
      </Notice>

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
  onSyncDrive,
  onOpenUser,
  onOpenModal,
}) {
  const [rootFolderId, setRootFolderId] = useState('');
  const [extractorInput, setExtractorInput] = useState('');
  const [copiedId, setCopiedId] = useState(false);

  const extractedInfo = extractDriveResourceInfo(extractorInput);

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
    <section className="panel wide-panel" aria-label="Sincronización de carpetas Google Drive">
      <div className="panel-title-between">
        <div className="panel-title">
          <h2>Carpetas y Google Docs en Drive</h2>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={syncBusy}
          aria-busy={syncBusy}
          onClick={() => onSyncDrive({ root_folder_id: rootFolderId.trim() || undefined })}
        >
          {syncBusy ? 'Sincronizando Drive…' : 'Sincronizar con Google Drive'}
        </button>
      </div>

      <Notice>
        Conecta la carpeta raíz compartida con la <strong>Service Account</strong> de CEMIPRE para detectar
        carpetas de usuarios, nuevos Google Docs, renombres y posibles archivos sin permiso de lectura.
      </Notice>

      <div className="id-extractor-box">
        <label className="sync-folder-input" htmlFor="drive-id-extractor-input">
          <span>Extractor rápido de ID de Google Drive (pega un enlace y obtén el ID para usuario)</span>
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

      <div className="sync-controls">
        <label className="sync-folder-input">
          <span>Carpeta raíz en Drive (URL o ID, opcional si ya está en secretos de Supabase)</span>
          <input
            type="text"
            placeholder="Ej.: https://drive.google.com/drive/folders/... o 1AbCdEf..."
            value={rootFolderId}
            onChange={(e) => setRootFolderId(e.target.value)}
          />
        </label>
      </div>

      {syncState && (
        <div className="sync-summary-box">
          <strong>Estado global registrado:</strong>{' '}
          <span>
            {syncState.ultima_sincronizacion
              ? formatDateTime(syncState.ultima_sincronizacion)
              : 'Sin sincronizaciones previas'}
          </span>
          <p className="muted">{syncState.ultimo_estado || 'Listo para sincronizar.'}</p>
        </div>
      )}

      {syncResult && (
        <div className="sync-report" aria-live="polite">
          <h3>Resultado de la última sincronización</h3>
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
        <h3>Carpetas por usuario (página actual)</h3>
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
                  ? `Carpeta Drive ID: ${p.drive_folder_id}`
                  : 'Sin carpeta Drive asignada (puedes editar el usuario o usar carpeta raíz)'}
              </small>
            </div>
            <div className="log-actions">
              <button
                type="button"
                className="btn btn-tiny"
                disabled={syncBusy}
                onClick={() => onSyncDrive({ persona_id: p.id })}
              >
                Sincronizar ficha
              </button>
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
        <Notice kind="warn">
          Solo cuentas con rol <strong>trabajador</strong> o <strong>admin</strong> pueden ver o modificar
          registros clínicos y bitácoras. Las cuentas nuevas inician como <strong>pendiente</strong>.
        </Notice>

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

      <section className="panel wide-panel" aria-label="Lista blanca de correos institucionales">
        <div className="panel-title">
          <h2>Lista blanca automática de correos</h2>
          <span className="count-pill">{whitelist.length}</span>
        </div>
        <p className="muted">
          Los correos agregados aquí reciben acceso automático al registrarse sin esperar aprobación manual.
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
            Agregar a lista blanca
          </button>
        </form>

        {whitelist.length > 0 && (
          <div className="logs-list">
            {whitelist.map((item) => (
              <article key={item.email} className="log-row">
                <div className="log-body">
                  <strong>{item.email}</strong>
                  <small>Rol automático: {item.rol}</small>
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
