import { Notice, Pagination, SummaryPanel, formatDateTime } from './SharedUI.jsx';

export function InicioView({
  stats,
  favorites,
  recentActivity,
  events,
  syncState,
  onNavigate,
  onOpenUser,
}) {
  const upcomingEvents = events
    .filter((ev) => new Date(ev.fin).getTime() >= Date.now())
    .slice(0, 4);

  return (
    <div className="dashboard-stack">
      <section className="stats stats-4" aria-label="Indicadores generales">
        <div className="stat-card">
          <span>Usuarios atendidos</span>
          <strong>{stats.totalPersonas}</strong>
          <small>Fichas registradas en Supabase</small>
        </div>
        <div className="stat-card">
          <span>Bitácoras vinculadas</span>
          <strong>{stats.totalVinculadas}</strong>
          <small>De {stats.totalBitacoras} bitácoras totales</small>
        </div>
        <div className="stat-card">
          <span>Eventos próximos</span>
          <strong>{stats.totalEventos}</strong>
          <small>Agenda compartida del equipo</small>
        </div>
        <div className="stat-card">
          <span>Tus favoritos</span>
          <strong>{favorites.length}</strong>
          <small>Accesos rápidos guardados</small>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel padded-panel" aria-label="Accesos rápidos">
          <div className="panel-heading-inline">
            <h2>Acciones rápidas</h2>
            <span className="muted">Flujo diario</span>
          </div>
          <div className="quick-actions-grid">
            <button type="button" className="quick-card" onClick={() => onNavigate('usuarios')}>
              <strong>Explorar usuarios y bitácoras</strong>
              <span>Buscar fichas, abrir Google Docs y dejar notas internas.</span>
            </button>
            <button type="button" className="quick-card" onClick={() => onNavigate('resumenes')}>
              <strong>Generar resumen con IA</strong>
              <span>Síntesis automática desde los Google Docs reales del usuario.</span>
            </button>
            <button type="button" className="quick-card" onClick={() => onNavigate('drive')}>
              <strong>Sincronizar carpetas Drive</strong>
              <span>Detectar nuevos Docs, renombres o archivos sin permisos.</span>
            </button>
            <button type="button" className="quick-card" onClick={() => onNavigate('calendario')}>
              <strong>Revisar calendario</strong>
              <span>Coordinar reuniones y fechas clave de CEMIPRE.</span>
            </button>
          </div>
        </section>

        <section className="panel padded-panel" aria-label="Estado de sincronización con Google Drive">
          <div className="panel-heading-inline">
            <h2>Integración Google Drive</h2>
            <button type="button" className="btn btn-tiny" onClick={() => onNavigate('drive')}>
              Ir a Drive
            </button>
          </div>
          {syncState?.ultima_sincronizacion ? (
            <div className="sync-summary-box">
              <p><strong>Última sincronización:</strong> {formatDateTime(syncState.ultima_sincronizacion)}</p>
              <p className="muted">{syncState.ultimo_estado || 'Estado operativo.'}</p>
            </div>
          ) : (
            <Notice kind="info">
              Aún no se ha ejecutado una sincronización con Google Drive desde esta instancia.
            </Notice>
          )}

          <h3 className="subpanel-title">Usuarios favoritos</h3>
          {favorites.length === 0 ? (
            <p className="muted">Marca usuarios con ★ desde la vista Usuarios para acceder más rápido.</p>
          ) : (
            <div className="chip-list">
              {favorites.slice(0, 6).map((fav) => (
                <button
                  key={fav.persona_id}
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => onOpenUser(fav.persona_id)}
                >
                  ★ {fav.personas?.codigo || `#${fav.persona_id}`} · {fav.personas?.nombre || ''}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel padded-panel" aria-label="Próximos eventos">
          <div className="panel-heading-inline">
            <h2>Próximos eventos</h2>
            <button type="button" className="btn btn-tiny" onClick={() => onNavigate('calendario')}>
              Ver todos
            </button>
          </div>
          {upcomingEvents.length === 0 ? (
            <p className="muted">No hay eventos próximos programados.</p>
          ) : (
            <ul className="compact-list">
              {upcomingEvents.map((ev) => (
                <li key={ev.id}>
                  <strong>{ev.titulo}</strong>
                  <small>{formatDateTime(ev.inicio)} · {ev.responsable}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel padded-panel" aria-label="Actividad reciente">
          <div className="panel-heading-inline">
            <h2>Actividad reciente</h2>
            <button type="button" className="btn btn-tiny" onClick={() => onNavigate('actividad')}>
              Historial
            </button>
          </div>
          {recentActivity.length === 0 ? (
            <p className="muted">Sin movimientos recientes registrados.</p>
          ) : (
            <ul className="compact-list">
              {recentActivity.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <strong>{item.descripcion}</strong>
                  <small>{item.actor_nombre} · {formatDateTime(item.fecha)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export function ResumenesIAView({
  people,
  peopleMeta,
  search,
  selectedId,
  person,
  summary,
  summaryLoading,
  onSearchChange,
  onPageChange,
  onSelectPerson,
  onGenerateSummary,
}) {
  return (
    <div className="content-grid">
      <section className="panel people-panel" aria-label="Seleccionar usuario para resumen">
        <div className="panel-title">
          <h2>Seleccionar usuario</h2>
          <span className="count-pill">{peopleMeta.total}</span>
        </div>
        <label className="search-field">
          <span className="sr-only">Buscar usuario para resumen IA</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar usuario…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
        <div className="people-list">
          {people.length === 0 ? (
            <p className="muted padded">No hay usuarios cargados con este filtro.</p>
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
                  <strong>{p.nombre}</strong>
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
          label="Paginación de usuarios para resumen"
        />
      </section>

      <section className="panel detail-panel" aria-label="Panel de resumen con inteligencia artificial">
        {!person ? (
          <div className="empty-state">Selecciona un usuario para generar su resumen con IA.</div>
        ) : (
          <div className="padded-panel">
            <div className="detail-heading compact-heading">
              <div className="title-with-icon">
                <div className="detail-avatar">{person.codigo.slice(-2)}</div>
                <div>
                  <p className="eyebrow">{person.codigo}</p>
                  <h2>{person.nombre}</h2>
                  <p className="muted">
                    {person.bitacoras.filter((b) => Boolean(b.google_doc_id)).length} de {person.bitacoras.length} bitácoras con Google Doc vinculado
                  </p>
                </div>
              </div>
            </div>

            <SummaryPanel
              summary={summary}
              loading={summaryLoading}
              onGenerate={onGenerateSummary}
              title="Síntesis clínica y administrativa con IA"
            />
          </div>
        )}
      </section>
    </div>
  );
}

export function FavoritosView({ favorites, onOpenUser, onRemoveFavorite, onNavigateToUsers }) {
  return (
    <section className="panel wide-panel" aria-label="Usuarios favoritos del trabajador">
      <div className="panel-title">
        <h2>Mis usuarios favoritos</h2>
        <span className="count-pill">{favorites.length}</span>
      </div>
      <p className="muted">
        Tus favoritos se guardan en Supabase por trabajador para acceder rápidamente a sus bitácoras.
      </p>

      {favorites.length === 0 ? (
        <div className="empty-state">
          <p>Todavía no has marcado usuarios como favoritos.</p>
          <button type="button" className="btn btn-secondary" onClick={onNavigateToUsers}>
            Explorar usuarios
          </button>
        </div>
      ) : (
        <div className="favorites-grid">
          {favorites.map((fav) => {
            const p = fav.personas;
            if (!p) return null;
            return (
              <article key={fav.id} className="favorite-card">
                <div className="title-with-icon">
                  <div className="person-avatar">{p.codigo.slice(-2)}</div>
                  <div>
                    <p className="eyebrow">{p.codigo}</p>
                    <h3>{p.nombre}</h3>
                  </div>
                </div>
                <div className="log-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-tiny-fill"
                    onClick={() => onOpenUser(p.id)}
                  >
                    Abrir bitácoras
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onRemoveFavorite(p.id)}
                    aria-label={`Quitar a ${p.nombre} de favoritos`}
                  >
                    Quitar ★
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
