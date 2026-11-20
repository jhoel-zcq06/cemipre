import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HOURS_OF_DAY,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  addDays,
  addMonths,
  buildDefaultSlotRange,
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
  layoutTimedEventsForDay,
  normalizeEvents,
  parseDateKey,
  toDateKey,
} from '../calendarUtils.js';
import { formatDateTime, toDateTimeLocalInput } from './SharedUI.jsx';

const WEEK_HOUR_HEIGHT = 52;
const DAY_HOUR_HEIGHT = 56;
const MAX_MONTH_CHIPS = 3;

const CALENDAR_VIEWS = [
  { id: 'month', label: 'Mensual' },
  { id: 'week', label: 'Semanal' },
  { id: 'day', label: 'Día' },
];

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

export function CalendarioView({ events = [], onOpenModal, initialDate }) {
  const [nowState, setNowState] = useState(() => ({
    todayKey: getTodayDateKey(),
    nowMinutes: getCurrentMinutesSantiago(),
  }));
  const [view, setView] = useState('month');
  const [activeDateKey, setActiveDateKey] = useState(() => initialDate || getTodayDateKey());
  const [selectedEventId, setSelectedEventId] = useState(null);
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

  const normalizedEvents = useMemo(() => normalizeEvents(events), [events]);

  const selectedEvent = useMemo(
    () => normalizedEvents.find((ev) => ev.id === selectedEventId) || null,
    [normalizedEvents, selectedEventId],
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
      map.set(key, getEventsForDay(normalizedEvents, key));
    }
    return map;
  }, [normalizedEvents, activeDateKey, monthCells, weekDays, miniCells]);

  const activeDayEvents = eventsByDayMap.get(activeDateKey) || [];

  const periodEventsCount = useMemo(() => {
    if (view === 'month') {
      const firstOfMonth = toDateKey(activeParts.year, activeParts.month, 1);
      const lastDayNum = new Date(Date.UTC(activeParts.year, activeParts.month, 0)).getUTCDate();
      const lastOfMonth = toDateKey(activeParts.year, activeParts.month, lastDayNum);
      return getEventsInRange(normalizedEvents, firstOfMonth, lastOfMonth).length;
    }
    if (view === 'week') {
      return getEventsInRange(normalizedEvents, weekDays[0], weekDays[6]).length;
    }
    return activeDayEvents.length;
  }, [view, activeParts.year, activeParts.month, normalizedEvents, weekDays, activeDayEvents.length]);

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
    () => normalizedEvents.filter((ev) => ev.effectiveEndKey >= nowState.todayKey).slice(0, 4),
    [normalizedEvents, nowState.todayKey],
  );

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

  function openCreateAt(dateKey, startHour = 9) {
    onOpenModal('new-event', buildDefaultSlotRange(dateKey, startHour, 60));
  }

  function openEditEvent(ev) {
    onOpenModal('edit-event', {
      ...ev.raw,
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

      <div className="cal-meta-strip">
        <div className="cal-meta-badges">
          <span className="count-pill">{periodCountLabel}</span>
          <span className="muted">Total agenda: {normalizedEvents.length}</span>
        </div>
        <span className="muted">
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
                      const visibleEvents = dayEvents.slice(0, MAX_MONTH_CHIPS);
                      const hiddenCount = dayEvents.length - visibleEvents.length;

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
                            {visibleEvents.map((ev) => (
                              <button
                                key={`${cell.dateKey}-${ev.id}`}
                                type="button"
                                className={`cal-event-chip cal-tone-${ev.tone} ${selectedEventId === ev.id ? 'is-active' : ''}`}
                                title={`${ev.titulo} (${ev.timeRangeLabel}) · ${ev.responsable}`}
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
                                title={`${ev.titulo} (${ev.timeRangeLabel})`}
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
                                  top: `${ev.topPct}%`,
                                  height: `${ev.heightPct}%`,
                                  left: `${ev.leftPct}%`,
                                  width: `${ev.widthPct}%`,
                                }}
                                title={`${ev.titulo} · ${ev.timeRangeLabel} · ${ev.responsable}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectEvent(ev, dateKey);
                                }}
                              >
                                <strong className="cal-timed-title">{ev.titulo}</strong>
                                <span className="cal-timed-time">{ev.timeRangeLabel}</span>
                                {ev.visualEndMin - ev.startMin >= 55 && (
                                  <span className="cal-timed-owner">{ev.responsable}</span>
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
                        ? 'Sin eventos programados para este día.'
                        : `${activeDayEvents.length} ${activeDayEvents.length === 1 ? 'evento programado' : 'eventos programados'}.`}
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
                          <span className="cal-timed-owner">{ev.responsable}</span>
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

        <aside className="cal-aside" aria-label="Detalle del día y eventos">
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

          {selectedEvent && (
            <div className={`cal-aside-card cal-event-detail-card cal-tone-${selectedEvent.tone}`}>
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
              <dl className="cal-detail-meta">
                <div>
                  <dt>Horario</dt>
                  <dd>
                    {formatDateTime(selectedEvent.inicio)} – {formatDateTime(selectedEvent.fin)}
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
                <p className="muted">No hay eventos programados para este día.</p>
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
                  >
                    <button
                      type="button"
                      className="cal-agenda-select"
                      onClick={() => setSelectedEventId(ev.id)}
                    >
                      <span className="cal-agenda-time">{ev.timeRangeLabel}</span>
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
                      <span className={`cal-upcoming-date cal-tone-${ev.tone}`}>
                        {formatShortDayLabel(ev.startKey)}
                      </span>
                      <span className="cal-upcoming-info">
                        <strong>{ev.titulo}</strong>
                        <small>{ev.timeRangeLabel} · {ev.responsable}</small>
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
