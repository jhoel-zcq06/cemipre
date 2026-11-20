export const CALENDAR_TIMEZONE = 'America/Santiago';

export const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const WEEKDAYS_LONG = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

export const MONTHS_LONG = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

export const HOURS_OF_DAY = Array.from({ length: 24 }, (_, i) => i);

const SANTIAGO_PARTS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: CALENDAR_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toDateKey(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function parseDateKey(dateKey) {
  const [y, m, d] = String(dateKey || '').split('-').map(Number);
  return {
    year: Number.isFinite(y) ? y : 2026,
    month: Number.isFinite(m) ? m : 1,
    day: Number.isFinite(d) ? d : 1,
  };
}

export function getSantiagoParts(dateInput) {
  if (!dateInput) return null;
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;

  const parts = SANTIAGO_PARTS_FMT.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const rawHour = Number(map.hour);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute);

  return {
    year,
    month,
    day,
    hour,
    minute,
    dateKey: toDateKey(year, month, day),
    minutesOfDay: hour * 60 + minute,
    ms: date.getTime(),
  };
}

export function getTodayDateKey(now = new Date()) {
  const parts = getSantiagoParts(now);
  return parts ? parts.dateKey : '2026-01-01';
}

export function getCurrentMinutesSantiago(now = new Date()) {
  const parts = getSantiagoParts(now);
  return parts ? parts.minutesOfDay : 0;
}

export function addDays(dateKey, delta) {
  const { year, month, day } = parseDateKey(dateKey);
  const next = new Date(Date.UTC(year, month - 1, day + delta));
  return toDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function addMonths(dateKey, delta) {
  const { year, month, day } = parseDateKey(dateKey);
  const firstOfTarget = new Date(Date.UTC(year, month - 1 + delta, 1));
  const targetYear = firstOfTarget.getUTCFullYear();
  const targetMonth = firstOfTarget.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return toDateKey(targetYear, targetMonth, Math.min(day, maxDay));
}

/**
 * Índice del día de la semana con Lunes = 0 y Domingo = 6 (convención es-CL).
 */
export function getWeekdayIndex(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (utcDay + 6) % 7;
}

export function getStartOfWeek(dateKey) {
  return addDays(dateKey, -getWeekdayIndex(dateKey));
}

export function getWeekDays(dateKey) {
  const monday = getStartOfWeek(dateKey);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Genera la cuadrícula completa de semanas (lunes a domingo) que cubre el mes indicado.
 */
export function getMonthGridDays(year, month) {
  const firstDayKey = toDateKey(year, month, 1);
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDayKey = toDateKey(year, month, lastDayNum);

  const gridStart = getStartOfWeek(firstDayKey);
  const gridEnd = addDays(lastDayKey, 6 - getWeekdayIndex(lastDayKey));

  const cells = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    const parsed = parseDateKey(cursor);
    cells.push({
      dateKey: cursor,
      year: parsed.year,
      month: parsed.month,
      day: parsed.day,
      isCurrentMonth: parsed.year === year && parsed.month === month,
    });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

export function formatTimeHM(hour, minute = 0) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function formatMonthTitle(year, month) {
  return `${MONTHS_LONG[month - 1] || ''} ${year}`.trim();
}

export function formatWeekRangeTitle(weekDays) {
  if (!Array.isArray(weekDays) || weekDays.length === 0) return '';
  const first = parseDateKey(weekDays[0]);
  const last = parseDateKey(weekDays[weekDays.length - 1]);
  const firstMonth = MONTHS_SHORT[first.month - 1];
  const lastMonth = MONTHS_SHORT[last.month - 1];

  if (first.year === last.year && first.month === last.month) {
    return `${first.day} – ${last.day} ${lastMonth} ${last.year}`;
  }
  if (first.year === last.year) {
    return `${first.day} ${firstMonth} – ${last.day} ${lastMonth} ${last.year}`;
  }
  return `${first.day} ${firstMonth} ${first.year} – ${last.day} ${lastMonth} ${last.year}`;
}

export function formatDayTitle(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  const weekday = WEEKDAYS_LONG[getWeekdayIndex(dateKey)];
  const monthName = (MONTHS_LONG[month - 1] || '').toLowerCase();
  return `${weekday}, ${day} de ${monthName} de ${year}`;
}

export function formatShortDayLabel(dateKey) {
  const { month, day } = parseDateKey(dateKey);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

export function buildDateTimeLocalValue(dateKey, totalMinutes = 540) {
  const dayOffset = Math.floor(totalMinutes / 1440);
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const targetKey = dayOffset === 0 ? dateKey : addDays(dateKey, dayOffset);
  const hour = Math.floor(minutesInDay / 60);
  const minute = minutesInDay % 60;
  return `${targetKey}T${pad2(hour)}:${pad2(minute)}`;
}

export function buildDefaultSlotRange(dateKey, startHour = 9, durationMinutes = 60) {
  const startTotal = startHour * 60;
  return {
    inicio: buildDateTimeLocalValue(dateKey, startTotal),
    fin: buildDateTimeLocalValue(dateKey, startTotal + durationMinutes),
  };
}

export const EVENT_LABEL_PRESETS = [
  { id: 'General', label: 'General', tone: 0, color: '#6c87ff' },
  { id: 'Reunión clínica', label: 'Reunión clínica', tone: 1, color: '#36c993' },
  { id: 'Taller', label: 'Taller', tone: 2, color: '#a285ff' },
  { id: 'Evaluación', label: 'Evaluación', tone: 3, color: '#e5a944' },
  { id: 'Administrativo', label: 'Administrativo', tone: 4, color: '#3cb5dc' },
  { id: 'Urgente', label: 'Urgente', tone: 5, color: '#f06584' },
];

export const EVENT_COLOR_SWATCHES = EVENT_LABEL_PRESETS.map((p) => ({
  color: p.color,
  label: p.label,
  tone: p.tone,
}));

export function normalizeLabelName(value, fallback = 'General') {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned || fallback;
}

export function toLabelKey(label) {
  return normalizeLabelName(label).toLowerCase();
}

export function sanitizeHexColor(value) {
  const trimmed = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : '';
}

export function getPresetForLabel(label) {
  const key = toLabelKey(label);
  return EVENT_LABEL_PRESETS.find((p) => p.label.toLowerCase() === key) || null;
}

export function hexToToneStyle(hex) {
  const clean = sanitizeHexColor(hex);
  if (!clean) return undefined;
  const r = Number.parseInt(clean.slice(1, 3), 16);
  const g = Number.parseInt(clean.slice(3, 5), 16);
  const b = Number.parseInt(clean.slice(5, 7), 16);
  return {
    '--tone-accent': clean,
    '--tone-bg': `rgba(${r}, ${g}, ${b}, 0.22)`,
    '--tone-border': `rgba(${r}, ${g}, ${b}, 0.56)`,
    '--tone-text': '#f0f5ff',
  };
}

export function getEventTone(event) {
  const label = event?.etiqueta || event?.google_calendar_name || '';
  if (label) {
    const preset = getPresetForLabel(label);
    if (preset) return preset.tone;
  }
  const seed = String(label || event?.responsable || event?.titulo || event?.id || '0').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % EVENT_LABEL_PRESETS.length;
}

export function normalizeEvent(event) {
  if (!event) return null;
  const start = getSantiagoParts(event.inicio);
  const rawEnd = getSantiagoParts(event.fin);
  if (!start || !rawEnd) return null;

  const end = rawEnd.ms > start.ms
    ? rawEnd
    : getSantiagoParts(new Date(start.ms + 30 * 60_000));

  const endsAtMidnightAfterStart = end.dateKey > start.dateKey && end.minutesOfDay === 0;
  const effectiveEndKey = endsAtMidnightAfterStart ? addDays(end.dateKey, -1) : end.dateKey;
  const isMultiDay = effectiveEndKey > start.dateKey;
  const endMinutesOnSingleDay = endsAtMidnightAfterStart ? 1440 : end.minutesOfDay;
  const todoElDia = Boolean(event.todo_el_dia);
  const isFullDayBanner = todoElDia || isMultiDay || (start.minutesOfDay === 0 && endMinutesOnSingleDay >= 1439);

  const startTimeLabel = formatTimeHM(start.hour, start.minute);
  const endTimeLabel = endsAtMidnightAfterStart && !isMultiDay
    ? '24:00'
    : formatTimeHM(end.hour, end.minute);

  let timeRangeLabel;
  if (todoElDia && !isMultiDay) {
    timeRangeLabel = 'Todo el día';
  } else if (todoElDia && isMultiDay) {
    timeRangeLabel = `${formatShortDayLabel(start.dateKey)} – ${formatShortDayLabel(effectiveEndKey)} · Todo el día`;
  } else if (isMultiDay) {
    timeRangeLabel = `${formatShortDayLabel(start.dateKey)} ${startTimeLabel} – ${formatShortDayLabel(end.dateKey)} ${formatTimeHM(end.hour, end.minute)}`;
  } else {
    timeRangeLabel = `${startTimeLabel} – ${endTimeLabel}`;
  }

  const googleCalendarId = String(event.google_calendar_id || '').trim();
  const googleCalendarName = String(event.google_calendar_name || '').trim();
  const googleEventId = String(event.google_event_id || '').trim();
  const googleHtmlLink = String(event.google_html_link || '').trim();
  const origen = event.origen === 'google' ? 'google' : 'cemipre';
  const etiqueta = normalizeLabelName(event.etiqueta || googleCalendarName || 'General');
  const labelKey = toLabelKey(etiqueta);
  const preset = getPresetForLabel(etiqueta);
  const tone = preset ? preset.tone : getEventTone({ etiqueta });
  const explicitColor = sanitizeHexColor(event.color);
  const color = explicitColor || preset?.color || EVENT_LABEL_PRESETS[tone]?.color || '#6c87ff';

  return {
    raw: event,
    id: event.id,
    titulo: event.titulo || 'Evento sin título',
    descripcion: event.descripcion || '',
    responsable: event.responsable || 'Equipo CEMIPRE',
    etiqueta,
    labelKey,
    color,
    customColor: explicitColor,
    origen,
    todoElDia,
    isGoogleSynced: Boolean(googleEventId),
    googleCalendarId,
    googleCalendarName,
    googleEventId,
    googleHtmlLink,
    inicio: event.inicio,
    fin: event.fin,
    startKey: start.dateKey,
    endKey: end.dateKey,
    effectiveEndKey,
    startMinutes: start.minutesOfDay,
    endMinutes: isMultiDay ? 1440 : endMinutesOnSingleDay,
    startMs: start.ms,
    endMs: end.ms,
    isMultiDay,
    isFullDayBanner,
    startTimeLabel,
    timeRangeLabel,
    tone,
  };
}

export function collectCalendarLabels(normalizedEvents = []) {
  const byKey = new Map();
  for (const ev of normalizedEvents) {
    const existing = byKey.get(ev.labelKey);
    if (existing) {
      existing.count += 1;
      if (ev.origen === 'google') existing.hasGoogleEvents = true;
      if (ev.origen === 'cemipre') existing.hasLocalEvents = true;
      if (!existing.customColor && ev.customColor) {
        existing.customColor = ev.customColor;
        existing.color = ev.color;
      }
    } else {
      byKey.set(ev.labelKey, {
        key: ev.labelKey,
        label: ev.etiqueta,
        count: 1,
        tone: ev.tone,
        color: ev.color,
        customColor: ev.customColor,
        hasGoogleEvents: ev.origen === 'google',
        hasLocalEvents: ev.origen === 'cemipre',
        googleCalendarId: ev.googleCalendarId,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const aIsGoogleOnly = a.hasGoogleEvents && !a.hasLocalEvents;
    const bIsGoogleOnly = b.hasGoogleEvents && !b.hasLocalEvents;
    if (aIsGoogleOnly !== bIsGoogleOnly) return aIsGoogleOnly ? 1 : -1;
    if (a.key === 'general' && b.key !== 'general') return -1;
    if (b.key === 'general' && a.key !== 'general') return 1;
    return a.label.localeCompare(b.label, 'es');
  });
}

export function filterEventsByVisibleLabels(normalizedEvents = [], hiddenLabelKeys = null) {
  if (!hiddenLabelKeys) return normalizedEvents;
  const hiddenSet = hiddenLabelKeys instanceof Set ? hiddenLabelKeys : new Set(hiddenLabelKeys);
  if (hiddenSet.size === 0) return normalizedEvents;
  return normalizedEvents.filter((ev) => !hiddenSet.has(ev.labelKey));
}

export function normalizeEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.titulo.localeCompare(b.titulo, 'es'));
}

export function getEventsForDay(normalizedEvents, dateKey) {
  return normalizedEvents
    .filter((ev) => ev.startKey <= dateKey && ev.effectiveEndKey >= dateKey)
    .sort((a, b) => {
      if (a.isFullDayBanner !== b.isFullDayBanner) return a.isFullDayBanner ? -1 : 1;
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      if (a.endMinutes !== b.endMinutes) return b.endMinutes - a.endMinutes;
      return a.titulo.localeCompare(b.titulo, 'es');
    });
}

export function getEventsInRange(normalizedEvents, startKey, endKey) {
  return normalizedEvents.filter((ev) => ev.startKey <= endKey && ev.effectiveEndKey >= startKey);
}

/**
 * Calcula columnas y posiciones verticales/horizontales para eventos con horario en un mismo día,
 * evitando que los eventos superpuestos se tapen entre sí.
 */
export function layoutTimedEventsForDay(dayEvents) {
  const timed = dayEvents
    .filter((ev) => !ev.isFullDayBanner)
    .map((ev) => {
      const startMin = Math.max(0, Math.min(1435, ev.startMinutes));
      const actualEndMin = Math.max(startMin + 5, Math.min(1440, ev.endMinutes));
      const visualEndMin = Math.min(1440, Math.max(actualEndMin, startMin + 30));
      return { ev, startMin, actualEndMin, visualEndMin };
    })
    .sort((a, b) => a.startMin - b.startMin || (b.visualEndMin - b.startMin) - (a.visualEndMin - a.startMin));

  if (timed.length === 0) return [];

  const clusters = [];
  let currentCluster = [];
  let clusterEnd = -1;

  for (const item of timed) {
    if (currentCluster.length === 0 || item.startMin < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.visualEndMin);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.visualEndMin;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const positioned = [];

  for (const cluster of clusters) {
    const columnEndTimes = [];
    const columnItems = [];

    for (const item of cluster) {
      let col = columnEndTimes.findIndex((endMin) => endMin <= item.startMin);
      if (col === -1) {
        col = columnEndTimes.length;
        columnEndTimes.push(item.visualEndMin);
        columnItems.push([item]);
      } else {
        columnEndTimes[col] = item.visualEndMin;
        columnItems[col].push(item);
      }
      item.column = col;
    }

    const totalColumns = columnEndTimes.length;

    for (const item of cluster) {
      let colSpan = 1;
      for (let nextCol = item.column + 1; nextCol < totalColumns; nextCol += 1) {
        const collides = columnItems[nextCol].some(
          (other) => other.startMin < item.visualEndMin && other.visualEndMin > item.startMin,
        );
        if (collides) break;
        colSpan += 1;
      }

      positioned.push({
        ...item.ev,
        startMin: item.startMin,
        endMin: item.actualEndMin,
        visualEndMin: item.visualEndMin,
        column: item.column,
        colSpan,
        totalColumns,
        topPct: (item.startMin / 1440) * 100,
        heightPct: ((item.visualEndMin - item.startMin) / 1440) * 100,
        leftPct: (item.column / totalColumns) * 100,
        widthPct: (colSpan / totalColumns) * 100,
      });
    }
  }

  return positioned;
}
