import { useEffect, useMemo, useRef, useState } from 'react';
import { hasGoogleCalendarScope } from '../api.js';
import {
  HOURS_OF_DAY,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  addDays,
  addMonths,
  buildDefaultSlotRange,
  collectCalendarLabels,
  filterEventsByVisibleLabels,
  formatDayTitle,
  formatMonthTitle,
  formatShortDayLabel,
  formatTimeHM,
  formatWeekRangeTitle,
  getCurrentMinutesSantiago,
  getEventsForDay,
  getEventsInRange,
  getMonthGridDays,
  getTodayDateKey,
  getWeekDays,
  getWeekdayIndex,
  hexToToneStyle,
  layoutTimedEventsForDay,
  normalizeEvents,
  parseDateKey,
  toDateKey,
  toLabelKey,
} from '../calendarUtils.js';
import { Notice, formatDateTime, toDateTimeLocalInput } from './SharedUI.jsx';

const WEEK_HOUR_HEIGHT = 52;
const DAY_HOUR_HEIGHT = 56;
const MAX_MONTH_CHIPS = 3;
const HIDDEN_LABELS_STORAGE_KEY = 'cemipre.calendar.hiddenLabels.v1';

const CALENDAR_VIEWS = [
  { id: 'month', label: 'Mensual' },
  { id: 'week', label: 'Semanal' },
  { id: 'day', label: 'Día' },
];

function readHiddenLabelsFromStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_LABELS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item) => typeof item === 'string' && item.trim()));
  } catch {
    return new Set();
  }
}

function writeHiddenLabelsToStorage(hiddenSet) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const list = Array.from(hiddenSet);
    if (list.length === 0) {
      window.localStorage.removeItem(HIDDEN_LABELS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HIDDEN_LABELS_STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignorar errores de cuota o modo privado
  }
}

function MiniCalendar({
  miniMonth,
  onChangeMonth,
  activeDateKey,
  todayKey,
  view,
  weekDaysSet,
  eventsByDayMap,
  onSelectDate,
}) {
  const cells = useMemo(
    () => getMonthGridDays(miniMonth.year, miniMonth.month),
    [miniMonth.year, miniMonth.month],
  );

  const monthTitle = formatMonthTitle(miniMonth.year, miniMonth.month);

  function stepMonth(delta) {
    const nextKey = addMonths(toDateKey(miniMonth.year, miniMonth.month, 1), delta);
    const parsed = parseDateKey(nextKey);
    onChangeMonth({ year: parsed.year, month: parsed.month });
  }

  return (
    <div className="cal-aside-card cal-mini-card" aria-label="Mini calendario mensual">
      <div className="cal-mini-header">
        <strong>{monthTitle}</strong>
        <div className="cal-step-buttons">
          <button
            type="button"
            className="btn btn-tiny cal-mini-nav-btn"
            aria-label="Mes anterior en mini calendario"
            onClick={() => stepMonth(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-tiny cal-mini-nav-btn"
            aria-label="Mes siguiente en mini calendario"
            onClick={() => stepMonth(1)}
          >
            ›
          </button>
        </div>
      </div>

      <div className="cal-mini-weekdays" aria-hidden="true">
        {WEEKDAYS_SHORT.map((day) => (
          <span key={day}>{day[0]}</span>
        ))}
      </div>

      <div className="cal-mini-grid">
        {cells.map((cell) => {
          const isToday = cell.dateKey === todayKey;
          const isSelected = cell.dateKey === activeDateKey;
          const inActiveWeek = view === 'week' && weekDaysSet.has(cell.dateKey);
          const hasEvents = (eventsByDayMap.get(cell.dateKey)?.length || 0) > 0;
          return (
            <button
              key={cell.dateKey}
              type="button"
              className={[
                'cal-mini-day',
                !cell.isCurrentMonth ? 'is-outside' : '',
                inActiveWeek ? 'is-in-week' : '',
                isToday ? 'is-today' : '',
                isSelected ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={`Ir al ${formatDayTitle(cell.dateKey)}`}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onSelectDate(cell.dateKey)}
            >
              <span>{cell.day}</span>
              {hasEvents && <i className="cal-mini-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GoogleCalendarConfigPanel({
  syncState,
  busy,
  onListGoogleCalendars,
  onSaveConfig,
  onConnectGoogleCalendar,
  onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set(
    Array.isArray(syncState?.calendars) ? syncState.calendars.map((c) => c.id) : [],
  ));
  const [syncDirection, setSyncDirection] = useState(syncState?.sync_direction || 'bidirectional');
  const [targetCalendarId, setTargetCalendarId] = useState(syncState?.target_calendar_id || 'primary');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (typeof onListGoogleCalendars !== 'function') {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError('');
      try {
        const res = await onListGoogleCalendars();
        if (cancelled) return;
        const cals = Array.isArray(res?.calendars) ? res.calendars : [];
        setAvailableCalendars(cals);
        const savedList = Array.isArray(res?.sync_state?.calendars)
          ? res.sync_state.calendars
          : (Array.isArray(syncState?.calendars) ? syncState.calendars : []);
        if (savedList.length > 0) {
          setSelectedIds(new Set(savedList.map((c) => c.id)));
        } else {
          const primary = cals.find((c) => c.primary) || cals[0];
          if (primary) setSelectedIds(new Set([primary.id]));
        }
        if (res?.sync_state?.sync_direction) {
          setSyncDirection(res.sync_state.sync_direction);
        }
        const savedTarget = res?.sync_state?.target_calendar_id || syncState?.target_calendar_id;
        if (savedTarget && cals.some((c) => c.id === savedTarget)) {
          setTargetCalendarId(savedTarget);
        } else {
          const writablePrimary = cals.find((c) => c.primary && c.writable) || cals.find((c) => c.writable);
          if (writablePrimary) setTargetCalendarId(writablePrimary.id);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'No se pudo cargar la lista de Google Calendar.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [onListGoogleCalendars, syncState]);

  const writableCalendars = useMemo(
    () => availableCalendars.filter((c) => c.writable),
    [availableCalendars],
  );

  function toggleCalendar(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (typeof onSaveConfig !== 'function') return;
    setSaving(true);
    try {
      const chosen = availableCalendars
        .filter((c) => selectedIds.has(c.id))
        .map((c) => ({
          id: c.id,
          summary: c.summary,
          backgroundColor: c.backgroundColor,
          primary: c.primary,
          accessRole: c.accessRole,
        }));
      const targetCal = writableCalendars.find((c) => c.id === targetCalendarId)
        || writableCalendars[0]
        || chosen[0];
      const ok = await onSaveConfig({
        calendars: chosen,
        sync_direction: syncDirection,
        target_calendar_id: targetCal?.id || 'primary',
        target_calendar_name: targetCal?.summary || 'Principal',
      });
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cal-google-config" role="region" aria-label="Configuración de sincronización con Google Calendar">
      <div className="cal-google-config-head">
        <div>
          <h3>Sincronización con Google Calendar</h3>
          <p className="muted">
            Elige qué calendarios de Google se sincronizan con la agenda compartida de CEMIPRE.
          </p>
        </div>
        <button type="button" className="btn btn-tiny" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {loadError && (
        <Notice kind="warn">
          {loadError}{' '}
          {onConnectGoogleCalendar && (
            <button
              type="button"
              className="inline-button"
              onClick={() => onConnectGoogleCalendar()}
            >
              Autorizar Google Calendar
            </button>
          )}
        </Notice>
      )}

      {loading ? (
        <p className="muted">Cargando tus calendarios de Google…</p>
      ) : availableCalendars.length === 0 ? (
        <p className="muted">No se encontraron calendarios disponibles en la cuenta Google conectada.</p>
      ) : (
        <form onSubmit={handleSubmit} className="cal-google-config-form">
          <fieldset className="cal-google-fieldset">
            <legend>Calendarios a sincronizar</legend>
            <div className="cal-google-cal-list">
              {availableCalendars.map((cal) => {
                const checked = selectedIds.has(cal.id);
                return (
                  <label key={cal.id} className="cal-google-cal-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCalendar(cal.id)}
                    />
                    <span
                      className="cal-label-swatch"
                      style={{ backgroundColor: cal.backgroundColor || '#4285f4' }}
                      aria-hidden="true"
                    />
                    <span className="cal-google-cal-name">
                      <strong>{cal.summary}</strong>
                      <small>
                        {cal.primary ? 'Principal' : (cal.writable ? 'Lectura y escritura' : 'Solo lectura')}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="cal-google-config-controls">
            <label className="cal-google-select-field">
              <span>Modo de sincronización</span>
              <select
                className="role-select"
                value={syncDirection}
                onChange={(e) => setSyncDirection(e.target.value)}
              >
                <option value="bidirectional">Bidireccional (importa de Google y publica eventos de CEMIPRE)</option>
                <option value="import_only">Solo importar eventos desde Google Calendar</option>
              </select>
            </label>

            {syncDirection === 'bidirectional' && writableCalendars.length > 0 && (
              <label className="cal-google-select-field">
                <span>Calendario destino para nuevos eventos de CEMIPRE</span>
                <select
                  className="role-select"
                  value={targetCalendarId}
                  onChange={(e) => setTargetCalendarId(e.target.value)}
                >
                  {writableCalendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.summary}{cal.primary ? ' (Principal)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="cal-detail-actions">
            <button
              type="submit"
              className="btn btn-tiny btn-primary"
              disabled={saving || busy || selectedIds.size === 0}
              aria-busy={saving || busy}
            >
              {saving || busy ? 'Guardando y sincronizando…' : 'Guardar y sincronizar'}
            </button>
            {onConnectGoogleCalendar && (
              <button
                type="button"
                className="btn btn-tiny"
                onClick={() => onConnectGoogleCalendar()}
              >
                Cambiar cuenta Google
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

export function CalendarioView({
  events = [],
  onOpenModal,
  initialDate,
  driveStatus = null,
  calendarSyncState = null,
  calendarSyncBusy = false,
  onConnectGoogleCalendar,
  onSyncGoogleCalendar,
  onListGoogleCalendars,
  onSaveGoogleCalendarConfig,
}) {
  const [nowState, setNowState] = useState(() => ({
    todayKey: getTodayDateKey(),
    nowMinutes: getCurrentMinutesSantiago(),
  }));
  const [view, setView] = useState('month');
  const [activeDateKey, setActiveDateKey] = useState(() => initialDate || getTodayDateKey());
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [hiddenLabels, setHiddenLabels] = useState(() => readHiddenLabelsFromStorage());
  const [showGoogleConfig, setShowGoogleConfig] = useState(false);
  const [miniMonth, setMiniMonth] = useState(() => {
    const parsed = parseDateKey(initialDate || getTodayDateKey());
    return { year: parsed.year, month: parsed.month };
  });

  const timeGridScrollRef = useRef(null);

  useEffect(() => {
    const parsed = parseDateKey(activeDateKey);
    setMiniMonth((prev) => (
      prev.year === parsed.year && prev.month === parsed.month
        ? prev
        : { year: parsed.year, month: parsed.month }
    ));
  }, [activeDateKey]);

  useEffect(() => {
    if (view !== 'week' && view !== 'day') return;
    const container = timeGridScrollRef.current;
    if (!container) return;
    const hourHeight = view === 'day' ? DAY_HOUR_HEIGHT : WEEK_HOUR_HEIGHT;
    container.scrollTop = Math.round(hourHeight * 7.5);
  }, [view]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowState({
        todayKey: getTodayDateKey(),
        nowMinutes: getCurrentMinutesSantiago(),
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const allNormalizedEvents = useMemo(() => normalizeEvents(events), [events]);

  const calendarLabels = useMemo(() => {
    const base = collectCalendarLabels(allNormalizedEvents);
    const byKey = new Map(base.map((item) => [item.key, item]));
    const syncedCals = Array.isArray(calendarSyncState?.calendars) ? calendarSyncState.calendars : [];
    for (const cal of syncedCals) {
      const summary = String(cal?.summary || '').trim();
      if (!summary) continue;
      const key = toLabelKey(summary);
      if (!byKey.has(key)) {
        const entry = {
          key,
          label: summary,
          count: 0,
          tone: 0,
          color: cal.backgroundColor || '#4285f4',
          customColor: cal.backgroundColor || '#4285f4',
          hasGoogleEvents: true,
          hasLocalEvents: false,
          googleCalendarId: cal.id || '',
        };
        byKey.set(key, entry);
        base.push(entry);
      }
    }
    return base;
  }, [allNormalizedEvents, calendarSyncState]);

  const activeHiddenCount = useMemo(
    () => calendarLabels.filter((item) => hiddenLabels.has(item.key)).length,
    [calendarLabels, hiddenLabels],
  );

  const visibleEvents = useMemo(
    () => filterEventsByVisibleLabels(allNormalizedEvents, hiddenLabels),
    [allNormalizedEvents, hiddenLabels],
  );

  const selectedEvent = useMemo(
    () => visibleEvents.find((ev) => ev.id === selectedEventId) || null,
    [visibleEvents, selectedEventId],
  );

  const activeParts = useMemo(() => parseDateKey(activeDateKey), [activeDateKey]);
  const monthCells = useMemo(
    () => getMonthGridDays(activeParts.year, activeParts.month),
    [activeParts.year, activeParts.month],
  );
  const monthWeeks = useMemo(() => {
    const rows = [];
    for (let i = 0; i < monthCells.length; i += 7) {
      rows.push(monthCells.slice(i, i + 7));
    }
    return rows;
  }, [monthCells]);
  const weekDays = useMemo(() => getWeekDays(activeDateKey), [activeDateKey]);
  const weekDaysSet = useMemo(() => new Set(weekDays), [weekDays]);

  const miniCells = useMemo(
    () => getMonthGridDays(miniMonth.year, miniMonth.month),
    [miniMonth.year, miniMonth.month],
  );

  const eventsByDayMap = useMemo(() => {
    const map = new Map();
    const keys = new Set([activeDateKey]);
    for (const cell of monthCells) keys.add(cell.dateKey);
    for (const key of weekDays) keys.add(key);
    for (const cell of miniCells) keys.add(cell.dateKey);
    for (const key of keys) {
      map.set(key, getEventsForDay(visibleEvents, key));
    }
    return map;
  }, [visibleEvents, activeDateKey, monthCells, weekDays, miniCells]);

  const activeDayEvents = eventsByDayMap.get(activeDateKey) || [];

  const periodEventsCount = useMemo(() => {
    if (view === 'month') {
      const firstOfMonth = toDateKey(activeParts.year, activeParts.month, 1);
      const lastDayNum = new Date(Date.UTC(activeParts.year, activeParts.month, 0)).getUTCDate();
      const lastOfMonth = toDateKey(activeParts.year, activeParts.month, lastDayNum);
      return getEventsInRange(visibleEvents, firstOfMonth, lastOfMonth).length;
    }
    if (view === 'week') {
      return getEventsInRange(visibleEvents, weekDays[0], weekDays[6]).length;
    }
    return activeDayEvents.length;
  }, [view, activeParts.year, activeParts.month, visibleEvents, weekDays, activeDayEvents.length]);

  const weekBannerEventsByDay = useMemo(() => {
    const perDay = weekDays.map((key) => (eventsByDayMap.get(key) || []).filter((ev) => ev.isFullDayBanner));
    const hasAny = perDay.some((list) => list.length > 0);
    return { perDay, hasAny };
  }, [weekDays, eventsByDayMap]);

  const weekTimedLayoutByDay = useMemo(
    () => weekDays.map((key) => layoutTimedEventsForDay(eventsByDayMap.get(key) || [])),
    [weekDays, eventsByDayMap],
  );

  const activeDayBannerEvents = useMemo(
    () => activeDayEvents.filter((ev) => ev.isFullDayBanner),
    [activeDayEvents],
  );

  const activeDayTimedEvents = useMemo(
    () => layoutTimedEventsForDay(activeDayEvents),
    [activeDayEvents],
  );

  const upcomingEvents = useMemo(
    () => visibleEvents.filter((ev) => ev.effectiveEndKey >= nowState.todayKey).slice(0, 4),
    [visibleEvents, nowState.todayKey],
  );

  const calendarConnected = hasGoogleCalendarScope(driveStatus);
  const showGoogleControls = Boolean(onConnectGoogleCalendar || onSyncGoogleCalendar);

  const periodTitle = view === 'month'
    ? formatMonthTitle(activeParts.year, activeParts.month)
    : view === 'week'
      ? formatWeekRangeTitle(weekDays)
      : formatDayTitle(activeDateKey);

  const periodCountLabel = view === 'month'
    ? `${periodEventsCount} ${periodEventsCount === 1 ? 'evento' : 'eventos'} en este mes`
    : view === 'week'
      ? `${periodEventsCount} ${periodEventsCount === 1 ? 'evento' : 'eventos'} en esta semana`
      : `${periodEventsCount} ${periodEventsCount === 1 ? 'evento' : 'eventos'} este día`;

  const prevLabel = view === 'month' ? 'Mes anterior' : view === 'week' ? 'Semana anterior' : 'Día anterior';
  const nextLabel = view === 'month' ? 'Mes siguiente' : view === 'week' ? 'Semana siguiente' : 'Día siguiente';

  function handlePrev() {
    setActiveDateKey((curr) => {
      if (view === 'month') return addMonths(curr, -1);
      if (view === 'week') return addDays(curr, -7);
      return addDays(curr, -1);
    });
  }

  function handleNext() {
    setActiveDateKey((curr) => {
      if (view === 'month') return addMonths(curr, 1);
      if (view === 'week') return addDays(curr, 7);
      return addDays(curr, 1);
    });
  }

  function handleToday() {
    setActiveDateKey(nowState.todayKey);
    setSelectedEventId(null);
  }

  function toggleLabelVisibility(labelKey) {
    setHiddenLabels((prev) => {
      const next = new Set(prev);
      if (next.has(labelKey)) next.delete(labelKey);
      else next.add(labelKey);
      writeHiddenLabelsToStorage(next);
      return next;
    });
  }

  function handleShowAllLabels() {
    const empty = new Set();
    setHiddenLabels(empty);
    writeHiddenLabelsToStorage(empty);
  }

  function handleHideAllLabels() {
    const all = new Set(calendarLabels.map((item) => item.key));
    setHiddenLabels(all);
    writeHiddenLabelsToStorage(all);
    setSelectedEventId(null);
  }

  function openCreateAt(dateKey, startHour = 9) {
    onOpenModal('new-event', {
      ...buildDefaultSlotRange(dateKey, startHour, 60),
      etiqueta: 'General',
    });
  }

  function openEditEvent(ev) {
    onOpenModal('edit-event', {
      ...ev.raw,
      etiqueta: ev.etiqueta,
      color: ev.customColor || '',
      inicio: toDateTimeLocalInput(ev.inicio),
      fin: toDateTimeLocalInput(ev.fin),
    });
  }

  function openDeleteEvent(ev) {
    onOpenModal('delete-event', ev.raw);
  }

  function handleSelectEvent(ev, dateKey = ev.startKey) {
    setActiveDateKey(dateKey);
    setSelectedEventId(ev.id);
  }

  function handleOpenDayView(dateKey) {
    setActiveDateKey(dateKey);
    setSelectedEventId(null);
    setView('day');
  }

  const nowTopPct = (nowState.nowMinutes / 1440) * 100;

  return (
    <section className="panel wide-panel cal-panel" aria-label="Calendario compartido del equipo">
      <div className="cal-toolbar">
        <div className="cal-nav-group">
          <button
            type="button"
            className="btn btn-tiny"
            onClick={handleToday}
            aria-label="Ir a hoy"
          >
            Hoy
          </button>
          <div className="cal-step-buttons">
            <button
              type="button"
              className="btn btn-tiny cal-step-btn"
              onClick={handlePrev}
              aria-label={prevLabel}
            >
              ‹
            </button>
            <button
              type="button"
              className="btn btn-tiny cal-step-btn"
              onClick={handleNext}
              aria-label={nextLabel}
            >
              ›
            </button>
          </div>
          <h2 className="cal-period-title" aria-live="polite">
            {periodTitle}
          </h2>
        </div>

        <div className="cal-toolbar-right">
          {showGoogleControls && (
            <div className="cal-google-actions" aria-label="Sincronización con Google Calendar">
              {calendarConnected ? (
                <>
                  <span className="status-badge badge-ok" title={calendarSyncState?.ultimo_estado || 'Google Calendar conectado'}>
                    ● Google Calendar
                  </span>
                  {onSyncGoogleCalendar && (
                    <button
                      type="button"
                      className="btn btn-tiny"
                      disabled={calendarSyncBusy}
                      aria-busy={calendarSyncBusy}
                      onClick={() => onSyncGoogleCalendar()}
                    >
                      {calendarSyncBusy ? 'Sincronizando…' : '↻ Sincronizar'}
                    </button>
                  )}
                  {onListGoogleCalendars && (
                    <button
                      type="button"
                      className={`btn btn-tiny ${showGoogleConfig ? 'btn-primary' : ''}`}
                      aria-expanded={showGoogleConfig}
                      onClick={() => setShowGoogleConfig((v) => !v)}
                    >
                      ⚙ Calendarios
                    </button>
                  )}
                </>
              ) : (
                onConnectGoogleCalendar && (
                  <button
                    type="button"
                    className="btn btn-tiny btn-secondary"
                    disabled={calendarSyncBusy}
                    onClick={() => onConnectGoogleCalendar()}
                  >
                    ☁ Conectar Google Calendar
                  </button>
                )
              )}
            </div>
          )}

          <div className="cal-view-switcher" role="tablist" aria-label="Vista del calendario">
            {CALENDAR_VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                className={`cal-view-tab ${view === item.id ? 'active' : ''}`}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showGoogleConfig && calendarConnected && (
        <GoogleCalendarConfigPanel
          syncState={calendarSyncState}
          busy={calendarSyncBusy}
          onListGoogleCalendars={onListGoogleCalendars}
          onSaveConfig={onSaveGoogleCalendarConfig}
          onConnectGoogleCalendar={onConnectGoogleCalendar}
          onClose={() => setShowGoogleConfig(false)}
        />
      )}

      <div className="cal-meta-strip">
        <div className="cal-meta-badges">
          <span className="count-pill">{periodCountLabel}</span>
          <span className="muted">
            Mostrando {visibleEvents.length} de {allNormalizedEvents.length}
          </span>
          {activeHiddenCount > 0 && (
            <span className="status-badge badge-warn">
              {activeHiddenCount} {activeHiddenCount === 1 ? 'etiqueta oculta' : 'etiquetas ocultas'} ·{' '}
              <button type="button" className="inline-button" onClick={handleShowAllLabels}>
                Mostrar todas
              </button>
            </span>
          )}
        </div>
        <span className="muted">
          {calendarSyncState?.ultima_sincronizacion
            ? `Google Calendar: ${formatDateTime(calendarSyncState.ultima_sincronizacion)} · `
            : ''}
          Zona horaria América/Santiago · Haz clic en un día u horario para agendar
        </span>
      </div>

      <div className="cal-layout">
        <div className="cal-main-surface">
          {view === 'month' && (
            <div className="cal-month" role="grid" aria-label={`Calendario mensual de ${periodTitle}`}>
              <div className="cal-weekday-row" role="row">
                {WEEKDAYS_SHORT.map((shortLabel, idx) => (
                  <div
                    key={shortLabel}
                    role="columnheader"
                    aria-label={WEEKDAYS_LONG[idx]}
                    className={`cal-weekday-cell ${idx >= 5 ? 'is-weekend' : ''}`}
                  >
                    {shortLabel}
                  </div>
                ))}
              </div>

              <div className="cal-month-grid">
                {monthWeeks.map((week) => (
                  <div key={week[0].dateKey} className="cal-month-week-row" role="row">
                    {week.map((cell, dayIdx) => {
                      const dayEvents = eventsByDayMap.get(cell.dateKey) || [];
                      const isToday = cell.dateKey === nowState.todayKey;
                      const isSelected = cell.dateKey === activeDateKey;
                      const isWeekend = dayIdx >= 5;
                      const visibleDayEvents = dayEvents.slice(0, MAX_MONTH_CHIPS);
                      const hiddenCount = dayEvents.length - visibleDayEvents.length;

                      return (
                        <div
                          key={cell.dateKey}
                          role="gridcell"
                          data-date={cell.dateKey}
                          className={[
                            'cal-month-cell',
                            !cell.isCurrentMonth ? 'is-outside' : '',
                            isWeekend ? 'is-weekend' : '',
                            isToday ? 'is-today' : '',
                            isSelected ? 'is-selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            setActiveDateKey(cell.dateKey);
                            setSelectedEventId(null);
                          }}
                          onDoubleClick={() => handleOpenDayView(cell.dateKey)}
                        >
                          <div className="cal-month-cell-top">
                            <button
                              type="button"
                              className={`cal-day-num-btn ${isToday ? 'is-today' : ''}`}
                              aria-current={isToday ? 'date' : undefined}
                              aria-label={`Seleccionar ${formatDayTitle(cell.dateKey)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDateKey(cell.dateKey);
                                setSelectedEventId(null);
                              }}
                            >
                              {cell.day === 1 && !cell.isCurrentMonth
                                ? formatShortDayLabel(cell.dateKey)
                                : cell.day}
                            </button>
                            <button
                              type="button"
                              className="cal-cell-add-btn"
                              aria-label={`Crear evento el ${formatDayTitle(cell.dateKey)}`}
                              title="Crear evento este día"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDateKey(cell.dateKey);
                                openCreateAt(cell.dateKey, 9);
                              }}
                            >
                              +
                            </button>
                          </div>

                          <div className="cal-month-events">
                            {visibleDayEvents.map((ev) => (
                              <button
                                key={`${cell.dateKey}-${ev.id}`}
                                type="button"
                                className={`cal-event-chip cal-tone-${ev.tone} ${selectedEventId === ev.id ? 'is-active' : ''}`}
                                style={hexToToneStyle(ev.customColor)}
                                title={`${ev.titulo} (${ev.timeRangeLabel}) · ${ev.etiqueta} · ${ev.responsable}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectEvent(ev, cell.dateKey);
                                }}
                              >
                                <span className="cal-chip-time">
                                  {ev.isFullDayBanner ? '●' : ev.startTimeLabel}
                                </span>
                                <span className="cal-chip-title">{ev.titulo}</span>
                              </button>
                            ))}
                            {hiddenCount > 0 && (
                              <button
                                type="button"
                                className="cal-more-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDateKey(cell.dateKey);
                                  setSelectedEventId(null);
                                }}
                              >
                                +{hiddenCount} más
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'week' && (
            <div className="cal-timegrid-wrapper" aria-label={`Calendario semanal del ${periodTitle}`}>
              <div className="cal-timegrid-scroll cal-week-scroll" ref={timeGridScrollRef}>
                <div className="cal-week-inner">
                  <div className="cal-week-sticky-top">
                    <div className="cal-week-header">
                      <div className="cal-gutter-header">Hora</div>
                      {weekDays.map((dateKey, idx) => {
                        const parsed = parseDateKey(dateKey);
                        const isToday = dateKey === nowState.todayKey;
                        const isSelected = dateKey === activeDateKey;
                        return (
                          <button
                            key={dateKey}
                            type="button"
                            className={[
                              'cal-week-col-header',
                              isToday ? 'is-today' : '',
                              isSelected ? 'is-selected' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            aria-current={isToday ? 'date' : undefined}
                            aria-label={`Ver vista diaria de ${formatDayTitle(dateKey)}`}
                            onClick={() => handleOpenDayView(dateKey)}
                          >
                            <span className="cal-week-day-name">{WEEKDAYS_SHORT[idx]}</span>
                            <span className="cal-week-day-num">{parsed.day}</span>
                          </button>
                        );
                      })}
                    </div>

                    {weekBannerEventsByDay.hasAny && (
                      <div className="cal-allday-row" aria-label="Eventos de todo el día o varios días">
                        <div className="cal-allday-gutter">Todo el día</div>
                        {weekDays.map((dateKey, idx) => (
                          <div key={`allday-${dateKey}`} className="cal-allday-cell">
                            {weekBannerEventsByDay.perDay[idx].map((ev) => (
                              <button
                                key={`banner-${dateKey}-${ev.id}`}
                                type="button"
                                className={`cal-event-chip cal-tone-${ev.tone} ${selectedEventId === ev.id ? 'is-active' : ''}`}
                                style={hexToToneStyle(ev.customColor)}
                                title={`${ev.titulo} (${ev.timeRangeLabel}) · ${ev.etiqueta}`}
                                onClick={() => handleSelectEvent(ev, dateKey)}
                              >
                                <span className="cal-chip-title">{ev.titulo}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    className="cal-timegrid-body cal-week-body"
                    style={{ height: `${24 * WEEK_HOUR_HEIGHT}px` }}
                  >
                    <div className="cal-time-axis" aria-hidden="true">
                      {HOURS_OF_DAY.map((hour) => (
                        <div
                          key={hour}
                          className="cal-time-label"
                          style={{ height: `${WEEK_HOUR_HEIGHT}px` }}
                        >
                          <span>{formatTimeHM(hour, 0)}</span>
                        </div>
                      ))}
                    </div>

                    {weekDays.map((dateKey, colIdx) => {
                      const isToday = dateKey === nowState.todayKey;
                      const isWeekend = colIdx >= 5;
                      const positionedEvents = weekTimedLayoutByDay[colIdx];

                      return (
                        <div
                          key={dateKey}
                          data-date={dateKey}
                          className={[
                            'cal-day-column',
                            isToday ? 'is-today' : '',
                            isWeekend ? 'is-weekend' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {HOURS_OF_DAY.map((hour) => (
                            <button
                              key={`${dateKey}-${hour}`}
                              type="button"
                              className="cal-hour-slot"
                              style={{ height: `${WEEK_HOUR_HEIGHT}px` }}
                              aria-label={`Crear evento el ${formatDayTitle(dateKey)} a las ${formatTimeHM(hour, 0)}`}
                              onClick={() => {
                                setActiveDateKey(dateKey);
                                openCreateAt(dateKey, hour);
                              }}
                            />
                          ))}

                          {isToday && (
                            <div
                              className="cal-now-line"
                              style={{ top: `${nowTopPct}%` }}
                              aria-hidden="true"
                            />
                          )}

                          <div className="cal-events-overlay">
                            {positionedEvents.map((ev) => (
                              <button
                                key={`wk-${dateKey}-${ev.id}`}
                                type="button"
                                className={`cal-timed-event cal-tone-${ev.tone} ${selectedEventId === ev.id ? 'is-active' : ''}`}
                                style={{
                                  ...hexToToneStyle(ev.customColor),
                                  top: `${ev.topPct}%`,
                                  height: `${ev.heightPct}%`,
                                  left: `${ev.leftPct}%`,
                                  width: `${ev.widthPct}%`,
                                }}
                                title={`${ev.titulo} · ${ev.timeRangeLabel} · ${ev.etiqueta} · ${ev.responsable}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectEvent(ev, dateKey);
                                }}
                              >
                                <strong className="cal-timed-title">{ev.titulo}</strong>
                                <span className="cal-timed-time">{ev.timeRangeLabel}</span>
                                {ev.visualEndMin - ev.startMin >= 55 && (
                                  <span className="cal-timed-owner">{ev.etiqueta}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'day' && (
            <div className="cal-day-view" aria-label={`Calendario diario de ${periodTitle}`}>
              <div className="cal-day-banner">
                <div className="cal-day-banner-left">
                  <div className={`cal-day-badge ${activeDateKey === nowState.todayKey ? 'is-today' : ''}`}>
                    <strong>{activeParts.day}</strong>
                    <span>{WEEKDAYS_SHORT[getWeekdayIndex(activeDateKey)]}</span>
                  </div>
                  <div>
                    <div className="cal-day-banner-title">
                      <h3>{formatDayTitle(activeDateKey)}</h3>
                      {activeDateKey === nowState.todayKey && (
                        <span className="status-badge badge-ok">Hoy</span>
                      )}
                    </div>
                    <p className="muted">
                      {activeDayEvents.length === 0
                        ? 'Sin eventos visibles para este día.'
                        : `${activeDayEvents.length} ${activeDayEvents.length === 1 ? 'evento visible' : 'eventos visibles'}.`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-tiny btn-secondary"
                  onClick={() => openCreateAt(activeDateKey, 9)}
                >
                  + Evento este día
                </button>
              </div>

              {activeDayBannerEvents.length > 0 && (
                <div className="cal-allday-row cal-allday-single" aria-label="Eventos de todo el día o varios días">
                  <div className="cal-allday-gutter">Todo el día</div>
                  <div className="cal-allday-cell">
                    {activeDayBannerEvents.map((ev) => (
                      <button
                        key={`day-banner-${ev.id}`}
                        type="button"
                        className={`cal-event-chip cal-tone-${ev.tone} ${selectedEventId === ev.id ? 'is-active' : ''}`}
                        style={hexToToneStyle(ev.customColor)}
                        onClick={() => handleSelectEvent(ev, activeDateKey)}
                      >
                        <span className="cal-chip-time">{ev.timeRangeLabel}</span>
                        <span className="cal-chip-title">{ev.titulo}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="cal-timegrid-scroll" ref={timeGridScrollRef}>
                <div
                  className="cal-timegrid-body cal-day-body"
                  style={{ height: `${24 * DAY_HOUR_HEIGHT}px` }}
                >
                  <div className="cal-time-axis" aria-hidden="true">
                    {HOURS_OF_DAY.map((hour) => (
                      <div
                        key={hour}
                        className="cal-time-label"
                        style={{ height: `${DAY_HOUR_HEIGHT}px` }}
                      >
                        <span>{formatTimeHM(hour, 0)}</span>
                      </div>
                    ))}
                  </div>

                  <div
                    data-date={activeDateKey}
                    className={`cal-day-column cal-single-day-column ${activeDateKey === nowState.todayKey ? 'is-today' : ''}`}
                  >
                    {HOURS_OF_DAY.map((hour) => (
                      <button
                        key={`day-${activeDateKey}-${hour}`}
                        type="button"
                        className="cal-hour-slot"
                        style={{ height: `${DAY_HOUR_HEIGHT}px` }}
                        aria-label={`Crear evento el ${formatDayTitle(activeDateKey)} a las ${formatTimeHM(hour, 0)}`}
                        onClick={() => openCreateAt(activeDateKey, hour)}
                      />
                    ))}

                    {activeDateKey === nowState.todayKey && (
                      <div
                        className="cal-now-line"
                        style={{ top: `${nowTopPct}%` }}
                        aria-hidden="true"
                      />
                    )}

                    <div className="cal-events-overlay">
                      {activeDayTimedEvents.map((ev) => (
                        <button
                          key={`dy-${ev.id}`}
                          type="button"
                          className={`cal-timed-event cal-day-timed-event cal-tone-${ev.tone} ${selectedEventId === ev.id ? 'is-active' : ''}`}
                          style={{
                            ...hexToToneStyle(ev.customColor),
                            top: `${ev.topPct}%`,
                            height: `${ev.heightPct}%`,
                            left: `${ev.leftPct}%`,
                            width: `${ev.widthPct}%`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectEvent(ev, activeDateKey);
                          }}
                        >
                          <div className="cal-day-event-head">
                            <strong className="cal-timed-title">{ev.titulo}</strong>
                            <span className="cal-timed-time">{ev.timeRangeLabel}</span>
                          </div>
                          <span className="cal-timed-owner">
                            {ev.etiqueta} · {ev.responsable}
                          </span>
                          {ev.descripcion && ev.visualEndMin - ev.startMin >= 55 && (
                            <span className="cal-timed-desc">{ev.descripcion}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="cal-aside" aria-label="Detalle del día, etiquetas y eventos">
          {view !== 'month' && (
            <MiniCalendar
              miniMonth={miniMonth}
              onChangeMonth={setMiniMonth}
              activeDateKey={activeDateKey}
              todayKey={nowState.todayKey}
              view={view}
              weekDaysSet={weekDaysSet}
              eventsByDayMap={eventsByDayMap}
              onSelectDate={(dateKey) => {
                setActiveDateKey(dateKey);
                setSelectedEventId(null);
              }}
            />
          )}

          {calendarLabels.length > 0 && (
            <div className="cal-aside-card cal-labels-card" aria-label="Filtro de etiquetas y calendarios">
              <div className="cal-aside-card-head">
                <div>
                  <h3>Etiquetas y calendarios</h3>
                  <p className="muted cal-aside-subtitle">Marca o desmarca para mostrar u ocultar</p>
                </div>
                {activeHiddenCount > 0 ? (
                  <button
                    type="button"
                    className="inline-button muted"
                    onClick={handleShowAllLabels}
                  >
                    Mostrar todas
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-button muted"
                    onClick={handleHideAllLabels}
                  >
                    Ocultar todas
                  </button>
                )}
              </div>

              <div className="cal-labels-list">
                {calendarLabels.map((item) => {
                  const isVisible = !hiddenLabels.has(item.key);
                  return (
                    <label
                      key={item.key}
                      className={`cal-label-toggle ${isVisible ? '' : 'is-hidden'}`}
                    >
                      <input
                        type="checkbox"
                        className="cal-label-checkbox"
                        checked={isVisible}
                        aria-label={`Mostrar etiqueta ${item.label}`}
                        onChange={() => toggleLabelVisibility(item.key)}
                        style={{ accentColor: item.color }}
                      />
                      <span
                        className="cal-label-swatch"
                        style={{
                          backgroundColor: isVisible ? item.color : 'transparent',
                          borderColor: item.color,
                        }}
                        aria-hidden="true"
                      />
                      <span className="cal-label-name">
                        {item.label}
                        {item.hasGoogleEvents && !item.hasLocalEvents && (
                          <span className="cal-google-tag">Google</span>
                        )}
                      </span>
                      <span className="cal-label-count">{item.count}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {selectedEvent && (
            <div
              className={`cal-aside-card cal-event-detail-card cal-tone-${selectedEvent.tone}`}
              style={hexToToneStyle(selectedEvent.customColor)}
            >
              <div className="cal-aside-card-head">
                <span className="eyebrow">EVENTO SELECCIONADO</span>
                <button
                  type="button"
                  className="inline-button muted"
                  onClick={() => setSelectedEventId(null)}
                >
                  Cerrar
                </button>
              </div>
              <h3>{selectedEvent.titulo}</h3>
              <div className="cal-event-badges">
                <span
                  className={`cal-label-pill cal-tone-${selectedEvent.tone}`}
                  style={hexToToneStyle(selectedEvent.customColor)}
                >
                  <i className="cal-label-dot" style={{ backgroundColor: selectedEvent.color }} aria-hidden="true" />
                  {selectedEvent.etiqueta}
                </span>
                {selectedEvent.isGoogleSynced && (
                  <span className="status-badge badge-muted">Google Calendar</span>
                )}
              </div>
              <dl className="cal-detail-meta">
                <div>
                  <dt>Horario</dt>
                  <dd>
                    {selectedEvent.todoElDia
                      ? selectedEvent.timeRangeLabel
                      : `${formatDateTime(selectedEvent.inicio)} – ${formatDateTime(selectedEvent.fin)}`}
                  </dd>
                </div>
                <div>
                  <dt>Responsable</dt>
                  <dd>{selectedEvent.responsable}</dd>
                </div>
                {selectedEvent.descripcion && (
                  <div>
                    <dt>Descripción</dt>
                    <dd>{selectedEvent.descripcion}</dd>
                  </div>
                )}
              </dl>
              <div className="cal-detail-actions">
                <button
                  type="button"
                  className="btn btn-tiny btn-secondary"
                  onClick={() => openEditEvent(selectedEvent)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-tiny btn-danger-outline"
                  onClick={() => openDeleteEvent(selectedEvent)}
                >
                  Eliminar
                </button>
                {selectedEvent.googleHtmlLink && (
                  <a
                    className="btn btn-tiny btn-outline"
                    href={selectedEvent.googleHtmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Google Calendar ↗
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="cal-aside-card">
            <div className="cal-aside-card-head">
              <div>
                <h3>Agenda · {formatShortDayLabel(activeDateKey)}</h3>
                <p className="muted cal-aside-subtitle">{formatDayTitle(activeDateKey)}</p>
              </div>
              <button
                type="button"
                className="btn btn-tiny btn-primary"
                onClick={() => openCreateAt(activeDateKey, 9)}
              >
                + Nuevo
              </button>
            </div>

            {view !== 'day' && (
              <button
                type="button"
                className="btn btn-tiny cal-open-day-btn"
                onClick={() => handleOpenDayView(activeDateKey)}
              >
                Abrir vista diaria →
              </button>
            )}

            {activeDayEvents.length === 0 ? (
              <div className="cal-aside-empty">
                <p className="muted">
                  {activeHiddenCount > 0
                    ? 'No hay eventos visibles para este día con las etiquetas activas.'
                    : 'No hay eventos programados para este día.'}
                </p>
                <button
                  type="button"
                  className="btn btn-tiny btn-secondary"
                  onClick={() => openCreateAt(activeDateKey, 9)}
                >
                  + Crear evento este día
                </button>
              </div>
            ) : (
              <div className="cal-agenda-list">
                {activeDayEvents.map((ev) => (
                  <article
                    key={`agenda-${ev.id}`}
                    className={`cal-agenda-item cal-tone-${ev.tone} ${selectedEventId === ev.id ? 'is-active' : ''}`}
                    style={hexToToneStyle(ev.customColor)}
                  >
                    <button
                      type="button"
                      className="cal-agenda-select"
                      onClick={() => setSelectedEventId(ev.id)}
                    >
                      <span className="cal-agenda-top">
                        <span className="cal-agenda-time">{ev.timeRangeLabel}</span>
                        <span className="cal-agenda-label">{ev.etiqueta}</span>
                      </span>
                      <strong>{ev.titulo}</strong>
                      <small>
                        {ev.responsable}
                        {ev.descripcion ? ` · ${ev.descripcion}` : ''}
                      </small>
                    </button>
                    <div className="cal-agenda-actions">
                      <button
                        type="button"
                        className="btn btn-tiny"
                        aria-label={`Editar ${ev.titulo}`}
                        onClick={() => openEditEvent(ev)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-tiny btn-danger-outline"
                        aria-label={`Eliminar ${ev.titulo}`}
                        onClick={() => openDeleteEvent(ev)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {upcomingEvents.length > 0 && (
            <div className="cal-aside-card">
              <div className="cal-aside-card-head">
                <h3>Próximos eventos</h3>
                <span className="count-pill">{upcomingEvents.length}</span>
              </div>
              <ul className="cal-upcoming-list">
                {upcomingEvents.map((ev) => (
                  <li key={`up-${ev.id}`}>
                    <button
                      type="button"
                      className="cal-upcoming-btn"
                      onClick={() => handleSelectEvent(ev, ev.startKey)}
                    >
                      <span
                        className={`cal-upcoming-date cal-tone-${ev.tone}`}
                        style={hexToToneStyle(ev.customColor)}
                      >
                        {formatShortDayLabel(ev.startKey)}
                      </span>
                      <span className="cal-upcoming-info">
                        <strong>{ev.titulo}</strong>
                        <small>{ev.etiqueta} · {ev.timeRangeLabel}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
