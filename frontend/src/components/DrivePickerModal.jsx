import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';
import { Notice, formatDate } from './SharedUI.jsx';

const SECTIONS = [
  { id: 'my_drive', label: 'Mi unidad' },
  { id: 'shared_with_me', label: 'Compartidos conmigo' },
  { id: 'shared_drives', label: 'Unidades compartidas' },
];

/**
 * Selector accesible de carpetas y Google Docs directamente desde Google Drive.
 * Reutiliza Modal (focus trap, Escape, retorno de foco) y nunca expone tokens en cliente.
 */
export function DrivePickerModal({
  open,
  mode = 'docs',
  multiple = mode === 'docs',
  title,
  driveStatus,
  onConnectGoogle,
  onBrowse = api.browseDrive,
  onConfirm,
  onClose,
}) {
  const [section, setSection] = useState('my_drive');
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [activeDriveId, setActiveDriveId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [items, setItems] = useState([]);
  const [nextPageToken, setNextPageToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [selectedMap, setSelectedMap] = useState(() => new Map());

  const reqSeqRef = useRef(0);
  const currentFolder = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null;
  const isConnected = Boolean(driveStatus?.conectado);

  const modalTitle = title || (
    mode === 'folder'
      ? 'Elegir carpeta desde Google Drive'
      : 'Seleccionar bitácoras desde Google Drive'
  );

  // Reiniciar selección y ruta cuando se abre o cierra el modal
  useEffect(() => {
    setSection('my_drive');
    setBreadcrumbs([]);
    setActiveDriveId('');
    setSearchInput('');
    setActiveQuery('');
    setSelectedMap(new Map());
    setError('');
    setNeedsReconnect(false);
    if (!open) {
      setItems([]);
      setNextPageToken('');
    }
  }, [open, mode]);

  const fetchItems = useCallback(async ({
    targetSection,
    folderId = '',
    driveId = '',
    query = '',
    pageToken = '',
    append = false,
  }) => {
    const seq = ++reqSeqRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const res = await onBrowse({
        section: query ? 'search' : targetSection,
        folder_id: folderId,
        drive_id: driveId,
        query,
        mode,
        page_token: pageToken,
      });
      if (reqSeqRef.current !== seq) return;
      const incoming = Array.isArray(res?.items) ? res.items : [];
      setItems((prev) => (append ? [...prev, ...incoming] : incoming));
      setNextPageToken(res?.next_page_token || '');
      setNeedsReconnect(false);
    } catch (err) {
      if (reqSeqRef.current !== seq) return;
      const msg = err?.message || 'No se pudo listar Google Drive.';
      setError(msg);
      if (/reconect|conecta tu cuenta|expir/i.test(msg)) {
        setNeedsReconnect(true);
      }
      if (!append) setItems([]);
    } finally {
      if (reqSeqRef.current === seq) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [mode, onBrowse]);

  useEffect(() => {
    if (!open || !isConnected) return;
    fetchItems({
      targetSection: section,
      folderId: currentFolder?.id || '',
      driveId: activeDriveId,
      query: activeQuery,
      pageToken: '',
      append: false,
    });
  }, [open, isConnected, section, currentFolder?.id, activeDriveId, activeQuery, fetchItems]);

  if (!open) return null;

  function handleChangeSection(nextSection) {
    setSection(nextSection);
    setBreadcrumbs([]);
    setActiveDriveId('');
    setSearchInput('');
    setActiveQuery('');
  }

  function handleOpenFolder(item) {
    setActiveQuery('');
    setSearchInput('');
    if (section === 'shared_drives' && !currentFolder) {
      setActiveDriveId(item.drive_id || item.id);
    }
    setBreadcrumbs((prev) => [...prev, { id: item.id, name: item.name, drive_id: item.drive_id || activeDriveId }]);
  }

  function handleJumpBreadcrumb(index) {
    if (index < 0) {
      setBreadcrumbs([]);
      setActiveDriveId('');
      return;
    }
    const nextTrail = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(nextTrail);
    setActiveDriveId(nextTrail[nextTrail.length - 1]?.drive_id || '');
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    setBreadcrumbs([]);
    setActiveDriveId('');
    setActiveQuery(searchInput.trim());
  }

  function handleToggleSelect(item) {
    const folderPath = breadcrumbs.map((crumb) => crumb.name).filter(Boolean).join(' / ');
    const enrichedItem = item.kind === 'doc' && !item.folder_path && folderPath
      ? { ...item, folder_path: folderPath }
      : item;
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(enrichedItem.id)) {
        next.delete(enrichedItem.id);
      } else {
        if (!multiple) next.clear();
        next.set(enrichedItem.id, enrichedItem);
      }
      return next;
    });
  }

  function handleConfirmSelection() {
    const selected = Array.from(selectedMap.values());
    if (selected.length === 0) return;
    if (mode === 'folder') {
      onConfirm(selected[0]);
    } else {
      onConfirm(selected);
    }
  }

  const selectedCount = selectedMap.size;
  const activeSectionLabel = SECTIONS.find((s) => s.id === section)?.label || 'Mi unidad';

  return (
    <Modal title={modalTitle} onClose={onClose}>
      <div className="drive-picker-body">
        {!isConnected || needsReconnect ? (
          <div className="drive-picker-connect">
            <Notice kind="warn">
              {needsReconnect
                ? 'Tu sesión de Google Drive expiró. Vuelve a conectarla para continuar.'
                : 'Conecta tu cuenta de Google Drive para seleccionar carpetas o documentos.'}
            </Notice>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-autofocus="true"
                onClick={() => onConnectGoogle?.()}
              >
                Conectar mi cuenta Google Drive
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="drive-picker-account">
              <span className="status-badge badge-ok">● Google conectado</span>
              <small className="muted">{driveStatus.google_email || 'Sesión Google activa'}</small>
            </div>

            <div className="drive-picker-tabs" role="tablist" aria-label="Ubicación en Google Drive">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={!activeQuery && section === s.id}
                  className={`btn btn-tiny ${!activeQuery && section === s.id ? 'btn-primary' : ''}`}
                  onClick={() => handleChangeSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <form className="drive-picker-search" onSubmit={handleSearchSubmit}>
              <label className="sr-only" htmlFor="drive-picker-search-input">
                Buscar en Google Drive
              </label>
              <input
                id="drive-picker-search-input"
                type="search"
                data-autofocus="true"
                placeholder={
                  mode === 'folder'
                    ? 'Buscar carpeta por nombre…'
                    : 'Buscar bitácora o carpeta por nombre…'
                }
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button type="submit" className="btn btn-tiny btn-secondary" disabled={loading}>
                Buscar
              </button>
              {activeQuery && (
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => {
                    setSearchInput('');
                    setActiveQuery('');
                  }}
                >
                  Limpiar
                </button>
              )}
            </form>

            <nav className="drive-breadcrumbs" aria-label="Ruta actual en Google Drive">
              <button
                type="button"
                className="drive-crumb-btn"
                onClick={() => {
                  setActiveQuery('');
                  setSearchInput('');
                  handleJumpBreadcrumb(-1);
                }}
              >
                {activeQuery ? `Búsqueda: "${activeQuery}"` : activeSectionLabel}
              </button>
              {!activeQuery && breadcrumbs.map((crumb, idx) => (
                <span key={crumb.id} className="drive-crumb-sep">
                  <span aria-hidden="true">›</span>
                  <button
                    type="button"
                    className="drive-crumb-btn"
                    onClick={() => handleJumpBreadcrumb(idx)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>

            {mode === 'folder' && currentFolder && (
              <div className="drive-current-folder-bar">
                <span>
                  Carpeta abierta: <strong>{currentFolder.name}</strong>
                </span>
                <button
                  type="button"
                  className="btn btn-tiny btn-secondary"
                  onClick={() => onConfirm({ id: currentFolder.id, name: currentFolder.name })}
                >
                  Usar esta carpeta
                </button>
              </div>
            )}

            {error && <Notice kind="error">{error}</Notice>}

            <div className="drive-picker-list" aria-live="polite" aria-busy={loading}>
              {loading ? (
                <div className="empty-state">Cargando elementos de Google Drive…</div>
              ) : items.length === 0 ? (
                <div className="empty-state">
                  {activeQuery
                    ? 'No se encontraron archivos ni carpetas con ese término.'
                    : 'Esta ubicación no contiene carpetas ni Google Docs visibles.'}
                </div>
              ) : (
                items.map((item) => {
                  const isFolder = item.kind === 'folder';
                  const isDoc = item.kind === 'doc';
                  const isSelected = selectedMap.has(item.id);
                  const canSelect = (mode === 'folder' && isFolder) || (mode === 'docs' && isDoc);

                  return (
                    <article
                      key={`${item.kind}-${item.id}`}
                      className={`drive-picker-row ${isSelected ? 'selected' : ''}`}
                    >
                      <span className="drive-item-icon" aria-hidden="true">
                        {isFolder ? '▤' : '≡'}
                      </span>
                      <div className="drive-item-meta">
                        <strong>{item.name}</strong>
                        <small>
                          {isFolder ? 'Carpeta' : 'Google Docs'}
                          {item.modified_time ? ` · ${formatDate(item.modified_time)}` : ''}
                          {item.owner ? ` · ${item.owner}` : ''}
                        </small>
                      </div>
                      <div className="drive-item-actions">
                        {isFolder && (
                          <button
                            type="button"
                            className="btn btn-tiny"
                            onClick={() => handleOpenFolder(item)}
                          >
                            Abrir
                          </button>
                        )}
                        {canSelect && (
                          <button
                            type="button"
                            className={`btn btn-tiny ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                            aria-pressed={isSelected}
                            onClick={() => handleToggleSelect(item)}
                          >
                            {isSelected ? '✓ Seleccionado' : 'Seleccionar'}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })
              )}

              {nextPageToken && !loading && (
                <div className="drive-picker-more">
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={loadingMore}
                    onClick={() =>
                      fetchItems({
                        targetSection: section,
                        folderId: currentFolder?.id || '',
                        driveId: activeDriveId,
                        query: activeQuery,
                        pageToken: nextPageToken,
                        append: true,
                      })
                    }
                  >
                    {loadingMore ? 'Cargando más…' : 'Cargar más resultados'}
                  </button>
                </div>
              )}
            </div>

            <div className="drive-picker-footer">
              <span className="muted" aria-live="polite">
                {selectedCount === 0
                  ? mode === 'folder'
                    ? 'Selecciona una carpeta de la lista o abre una y pulsa "Usar esta carpeta".'
                    : 'Selecciona una o más bitácoras de Google Docs.'
                  : mode === 'folder'
                    ? `Carpeta seleccionada: ${Array.from(selectedMap.values())[0].name}`
                    : `${selectedCount} ${selectedCount === 1 ? 'bitácora seleccionada' : 'bitácoras seleccionadas'}`}
              </span>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={selectedCount === 0}
                  onClick={handleConfirmSelection}
                >
                  {mode === 'folder'
                    ? 'Confirmar carpeta'
                    : selectedCount > 1
                      ? `Vincular ${selectedCount} bitácoras`
                      : 'Confirmar bitácora'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
