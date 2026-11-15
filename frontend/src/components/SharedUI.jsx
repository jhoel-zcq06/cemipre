export const formatDate = (iso) => {
  if (!iso) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
};

export const formatDateTime = (iso) => {
  if (!iso) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
};

export const toDateTimeLocalInput = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
};

export function Notice({ children, kind = 'info', onDismiss, className = '' }) {
  const role = kind === 'error' ? 'alert' : 'status';
  return (
    <div
      className={`notice notice-${kind} ${className}`.trim()}
      role={role}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <div className="notice-content">{children}</div>
      {onDismiss && (
        <button className="inline-button" type="button" onClick={onDismiss}>
          Cerrar
        </button>
      )}
    </div>
  );
}

const SYNC_STATUS_META = {
  sincronizada: { label: 'Sincronizada', cls: 'badge-ok', symbol: '●' },
  pendiente: { label: 'Pendiente de verificar', cls: 'badge-warn', symbol: '◐' },
  sin_permiso: { label: 'Sin permiso en Drive', cls: 'badge-error', symbol: '!' },
  no_encontrada: { label: 'No encontrada en Drive', cls: 'badge-error', symbol: '✕' },
  sin_enlace: { label: 'Sin documento vinculado', cls: 'badge-muted', symbol: '○' },
};

export function SyncStatusBadge({ estado, urlDocs }) {
  const key = estado || (urlDocs ? 'pendiente' : 'sin_enlace');
  const meta = SYNC_STATUS_META[key] || SYNC_STATUS_META.pendiente;
  return (
    <span className={`status-badge ${meta.cls}`}>
      <span aria-hidden="true">{meta.symbol}</span> {meta.label}
    </span>
  );
}

export function Pagination({ page, totalPages, totalItems, onPageChange, label = 'Paginación' }) {
  if (totalPages <= 1 && totalItems <= 15) return null;
  return (
    <nav className="pagination" aria-label={label}>
      <button
        type="button"
        className="btn btn-tiny"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Anterior
      </button>
      <span className="pagination-info">
        Página {page} de {totalPages} · {totalItems} registros
      </span>
      <button
        type="button"
        className="btn btn-tiny"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Siguiente →
      </button>
    </nav>
  );
}

const SOURCE_STATE_LABEL = {
  leida: 'Leída',
  vacia: 'Documento vacío',
  sin_enlace: 'Sin enlace Docs',
  sin_permiso: 'Sin permiso Drive',
  no_encontrada: 'No encontrado',
  error: 'Error de lectura',
};

export function SummaryPanel({ summary, loading, onGenerate, title = 'Resumen asistido por IA' }) {
  return (
    <div className="summary-card" aria-live="polite">
      <div className="summary-top">
        <span className="sparkle" aria-hidden="true">✧</span>
        <div>
          <h3>{title}</h3>
          <p>
            Lee el contenido real de los Google Docs autorizados con minimización de datos.
            Requiere revisión profesional antes de tomar decisiones.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onGenerate}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? 'Generando…' : 'Generar resumen IA'}
        </button>
      </div>

      {summary && (
        <div className="summary-result">
          <div className="summary-meta">
            <strong>
              {summary.codigo ? `${summary.codigo} · ` : ''}
              {summary.nombre || 'Resumen'} ({summary.bitacoras_leidas}/{summary.cantidad_bitacoras} bitácoras leídas)
            </strong>
            <span className="muted">
              {formatDateTime(summary.generado_en)} · Modelo: {summary.modelo}
            </span>
          </div>

          <Notice kind="info">{summary.aviso_revision}</Notice>

          <div className="summary-block">
            <h4>Estado general</h4>
            <p>{summary.estado_general}</p>
          </div>

          {summary.avances_recientes.length > 0 && (
            <div className="summary-block">
              <h4>Avances recientes</h4>
              <ul>
                {summary.avances_recientes.map((item, idx) => (
                  <li key={`av-${idx}`}>
                    {item.punto}{' '}
                    <span className="source-tag">
                      [Fuente: {item.fuente}{item.fecha ? ` · ${item.fecha}` : ''}]
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.acciones_pendientes.length > 0 && (
            <div className="summary-block">
              <h4>Acciones pendientes</h4>
              <ul>
                {summary.acciones_pendientes.map((item, idx) => (
                  <li key={`ac-${idx}`}>
                    {item.accion}{' '}
                    <span className="source-tag">[Fuente: {item.fuente}]</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.incertidumbres.length > 0 && (
            <div className="summary-block">
              <h4>Advertencias e incertidumbres</h4>
              <ul className="warning-list">
                {summary.incertidumbres.map((warn, idx) => (
                  <li key={`inc-${idx}`}>{warn}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.fuentes.length > 0 && (
            <div className="summary-block">
              <h4>Estado de fuentes consultadas</h4>
              <ul className="sources-grid">
                {summary.fuentes.map((f) => (
                  <li key={f.bitacora_id || f.titulo}>
                    <strong>{f.titulo}:</strong> {SOURCE_STATE_LABEL[f.estado] || f.estado} — {f.detalle}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
