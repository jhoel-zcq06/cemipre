import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import {
  GoogleApiError,
  resolveDriveTokenCandidates,
  type ResolvedDriveToken,
} from '../_shared/google.ts';
import { AuthError, getSupabaseAdmin, requireAuthorizedWorker } from '../_shared/supabase.ts';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const SANTIAGO_TZ = 'America/Santiago';

const GOOGLE_EVENT_COLOR_HEX: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
};

interface SelectedCalendarConfig {
  id: string;
  summary: string;
  backgroundColor: string;
  primary?: boolean;
  accessRole?: string;
}

interface GoogleCalendarListItem {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
  selected?: boolean;
  hidden?: boolean;
}

interface GoogleCalendarEventItem {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  etag?: string;
  updated?: string;
  colorId?: string;
  organizer?: { displayName?: string; email?: string };
  creator?: { displayName?: string; email?: string };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

class CalendarScopeError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 403, code = 'calendar_scope_required') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SANTIAGO_PARTS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: SANTIAGO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function formatPartsInSantiago(date: Date) {
  const parts = SANTIAGO_PARTS_FMT.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const rawHour = Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Convierte una fecha civil 'YYYY-MM-DD' a su instante UTC exacto correspondiente
 * a las 00:00:00 en America/Santiago (respetando horario de verano/invierno).
 */
function santiagoDateToIso(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const targetUtcAsWall = Date.UTC(y, m - 1, d, 0, 0, 0);
  let candidate = targetUtcAsWall;
  for (let i = 0; i < 2; i += 1) {
    const p = formatPartsInSantiago(new Date(candidate));
    const wallAtCandidate = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = targetUtcAsWall - wallAtCandidate;
    if (diff === 0) break;
    candidate += diff;
  }
  return new Date(candidate).toISOString();
}

function sanitizeHexColor(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : '';
}

function normalizeSelectedCalendars(raw: unknown): SelectedCalendarConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: SelectedCalendarConfig[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      const id = item.trim().slice(0, 250);
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        summary: id === 'primary' ? 'Principal' : id,
        backgroundColor: '#4285f4',
        primary: id === 'primary',
      });
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id.trim().slice(0, 250) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        summary: typeof obj.summary === 'string' && obj.summary.trim()
          ? obj.summary.trim().slice(0, 60)
          : (id === 'primary' ? 'Principal' : id.slice(0, 60)),
        backgroundColor: sanitizeHexColor(typeof obj.backgroundColor === 'string' ? obj.backgroundColor : '') || '#4285f4',
        primary: Boolean(obj.primary),
        accessRole: typeof obj.accessRole === 'string' ? obj.accessRole : undefined,
      });
    }
  }
  return list;
}

async function calendarApiFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('https://') ? path : `${CALENDAR_API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });

  if (res.status === 204) {
    return {} as T;
  }

  const text = await res.text();
  if (!res.ok) {
    let reason = '';
    let message = '';
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      };
      message = parsed.error?.message || '';
      reason = parsed.error?.errors?.[0]?.reason || '';
    } catch {
      message = text.slice(0, 220);
    }

    if (res.status === 401) {
      throw new GoogleApiError(
        'La autorización de Google expiró. Vuelve a conectar tu cuenta Google.',
        401,
        'reconexion_requerida',
      );
    }

    if (
      res.status === 403
      && (reason === 'insufficientPermissions'
        || message.toLowerCase().includes('insufficient authentication scopes')
        || message.toLowerCase().includes('insufficient permission'))
    ) {
      throw new CalendarScopeError(
        'Tu cuenta Google aún no tiene permiso de Google Calendar. Pulsa "Conectar Google Calendar" para autorizarlo.',
        403,
        'calendar_scope_required',
      );
    }

    if (res.status === 403 && reason === 'accessNotConfigured') {
      throw new CalendarScopeError(
        'Google Calendar API no está habilitada en tu proyecto de Google Cloud Console. Actívala en APIs y servicios → Biblioteca → Google Calendar API.',
        403,
        'calendar_api_disabled',
      );
    }

    if (res.status === 404 || res.status === 410) {
      throw new GoogleApiError(
        message || 'Calendario o evento no encontrado en Google Calendar.',
        res.status,
        'no_encontrada',
      );
    }

    throw new GoogleApiError(
      `Error ${res.status} en Google Calendar: ${message || 'solicitud rechazada.'}`,
      res.status,
      res.status === 403 ? 'sin_permiso' : 'error_api',
    );
  }

  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

async function withCalendarToken<T>(
  candidates: ResolvedDriveToken[],
  operation: (candidate: ResolvedDriveToken) => Promise<T>,
): Promise<{ result: T; used: ResolvedDriveToken }> {
  if (candidates.length === 0) {
    throw new CalendarScopeError(
      'Primero conecta tu cuenta de Google Calendar para sincronizar eventos.',
      400,
      'calendar_not_connected',
    );
  }

  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const result = await operation(candidate);
      return { result, used: candidate };
    } catch (err) {
      lastErr = err;
      if (
        (err instanceof CalendarScopeError && err.code === 'calendar_scope_required')
        || (err instanceof GoogleApiError && (err.code === 'sin_permiso' || err.code === 'reconexion_requerida'))
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function fetchGoogleCalendarList(token: string) {
  const calendars: Array<{
    id: string;
    summary: string;
    description: string;
    primary: boolean;
    backgroundColor: string;
    accessRole: string;
    writable: boolean;
  }> = [];

  let pageToken = '';
  do {
    const qs = new URLSearchParams({
      minAccessRole: 'reader',
      showHidden: 'false',
      maxResults: '100',
    });
    if (pageToken) qs.set('pageToken', pageToken);

    const data = await calendarApiFetch<{
      items?: GoogleCalendarListItem[];
      nextPageToken?: string;
    }>(token, `/users/me/calendarList?${qs.toString()}`);

    for (const item of data.items ?? []) {
      if (!item.id) continue;
      const role = item.accessRole || 'reader';
      calendars.push({
        id: item.id,
        summary: (item.summaryOverride || item.summary || item.id).trim().slice(0, 60),
        description: (item.description || '').trim().slice(0, 240),
        primary: Boolean(item.primary),
        backgroundColor: sanitizeHexColor(item.backgroundColor) || '#4285f4',
        accessRole: role,
        writable: role === 'owner' || role === 'writer',
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  calendars.sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary, 'es'));
  return calendars;
}

async function fetchGoogleCalendarEvents(
  token: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<GoogleCalendarEventItem[]> {
  const items: GoogleCalendarEventItem[] = [];
  let pageToken = '';
  let pages = 0;

  do {
    const qs = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      maxResults: '250',
      showDeleted: 'false',
    });
    if (pageToken) qs.set('pageToken', pageToken);

    const data = await calendarApiFetch<{
      items?: GoogleCalendarEventItem[];
      nextPageToken?: string;
    }>(token, `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`);

    if (Array.isArray(data.items)) {
      items.push(...data.items);
    }
    pageToken = data.nextPageToken || '';
    pages += 1;
  } while (pageToken && pages < 8);

  return items;
}

function parseGoogleEventBounds(ev: GoogleCalendarEventItem): {
  inicio: string;
  fin: string;
  todo_el_dia: boolean;
} | null {
  if (!ev.start || !ev.end) return null;

  if (ev.start.dateTime && ev.end.dateTime) {
    const s = new Date(ev.start.dateTime);
    const e = new Date(ev.end.dateTime);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    const endMs = e.getTime() > s.getTime() ? e.getTime() : s.getTime() + 30 * 60_000;
    return {
      inicio: s.toISOString(),
      fin: new Date(endMs).toISOString(),
      todo_el_dia: false,
    };
  }

  if (ev.start.date && ev.end.date) {
    const startIso = santiagoDateToIso(ev.start.date);
    const rawEndIso = santiagoDateToIso(ev.end.date);
    const sMs = new Date(startIso).getTime();
    const eMs = new Date(rawEndIso).getTime();
    const safeEndIso = eMs > sMs ? rawEndIso : new Date(sMs + 24 * 3600_000).toISOString();
    return {
      inicio: startIso,
      fin: safeEndIso,
      todo_el_dia: true,
    };
  }

  return null;
}

async function getOrInitCalendarSyncState(adminClient: ReturnType<typeof getSupabaseAdmin>) {
  const { data } = await adminClient
    .from('google_calendar_sync_state')
    .select('*')
    .eq('id', 'global')
    .maybeSingle();

  if (data) return data;

  const fallback = {
    id: 'global',
    calendars: [],
    sync_direction: 'bidirectional',
    target_calendar_id: 'primary',
    target_calendar_name: 'Principal',
    auto_sync_enabled: true,
    sync_en_curso: false,
    ultima_sincronizacion: null,
    ultimo_estado: '',
  };
  await adminClient.from('google_calendar_sync_state').upsert(fallback);
  return fallback;
}

function buildGoogleEventRequestBody(row: {
  id: number;
  titulo: string;
  descripcion?: string;
  inicio: string;
  fin: string;
  responsable?: string;
  etiqueta?: string;
}) {
  return {
    summary: String(row.titulo || 'Evento CEMIPRE').slice(0, 160),
    description: [
      (row.descripcion || '').trim(),
      row.responsable ? `Responsable: ${row.responsable}` : '',
      row.etiqueta ? `Etiqueta: ${row.etiqueta}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2000),
    start: {
      dateTime: new Date(row.inicio).toISOString(),
      timeZone: SANTIAGO_TZ,
    },
    end: {
      dateTime: new Date(row.fin).toISOString(),
      timeZone: SANTIAGO_TZ,
    },
    extendedProperties: {
      private: {
        cemipre_evento_id: String(row.id),
        cemipre_etiqueta: String(row.etiqueta || 'General').slice(0, 60),
        cemipre_responsable: String(row.responsable || 'Equipo CEMIPRE').slice(0, 120),
      },
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return errorResponse('Método no permitido.', 405);
  }

  try {
    const { userId, perfil, adminClient } = await requireAuthorizedWorker(req);

    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return errorResponse('Cuerpo JSON inválido.');
    }

    const action = typeof body.action === 'string' ? body.action.trim() : 'sync';

    const { candidates, reconnectNeeded, lastAuthError } = await resolveDriveTokenCandidates(adminClient, {
      userId,
      preferInstitutional: false,
      includeServiceAccount: false,
    });

    if (candidates.length === 0 && action !== 'save-config') {
      return errorResponse(
        reconnectNeeded
          ? (lastAuthError || 'Tu sesión de Google expiró. Vuelve a conectar Google Calendar.')
          : 'Primero conecta tu cuenta de Google Calendar para sincronizar eventos.',
        reconnectNeeded ? 401 : 400,
        { code: reconnectNeeded ? 'reconexion_requerida' : 'calendar_not_connected' },
      );
    }

    if (action === 'list-calendars') {
      const syncState = await getOrInitCalendarSyncState(adminClient);
      const { result: calendars, used } = await withCalendarToken(
        candidates,
        (cand) => fetchGoogleCalendarList(cand.token),
      );
      return jsonResponse({
        ok: true,
        google_email: used.email || '',
        calendars,
        sync_state: syncState,
      });
    }

    if (action === 'save-config') {
      const calendars = normalizeSelectedCalendars(body.calendars);
      const syncDirection = body.sync_direction === 'import_only' ? 'import_only' : 'bidirectional';
      const targetId = typeof body.target_calendar_id === 'string' && body.target_calendar_id.trim()
        ? body.target_calendar_id.trim().slice(0, 250)
        : (calendars.find((c) => c.primary)?.id || calendars[0]?.id || 'primary');
      const targetName = typeof body.target_calendar_name === 'string' && body.target_calendar_name.trim()
        ? body.target_calendar_name.trim().slice(0, 60)
        : (calendars.find((c) => c.id === targetId)?.summary || 'Principal');

      const { data: saved, error: saveErr } = await adminClient
        .from('google_calendar_sync_state')
        .upsert({
          id: 'global',
          calendars,
          sync_direction: syncDirection,
          target_calendar_id: targetId,
          target_calendar_name: targetName,
          actualizado: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (saveErr) {
        return errorResponse(`No se pudo guardar la configuración de Google Calendar: ${saveErr.message}`, 500);
      }

      return jsonResponse({ ok: true, sync_state: saved });
    }

    if (action === 'push-event') {
      const eventoId = Number(body.evento_id);
      if (!Number.isFinite(eventoId) || eventoId <= 0) {
        return errorResponse('Falta evento_id válido para sincronizar.', 400);
      }

      const syncState = await getOrInitCalendarSyncState(adminClient);
      const { data: evRow, error: evErr } = await adminClient
        .from('eventos')
        .select('id, titulo, descripcion, inicio, fin, responsable, etiqueta, color, origen, google_event_id, google_calendar_id, google_calendar_name')
        .eq('id', eventoId)
        .maybeSingle();

      if (evErr || !evRow) {
        return errorResponse('Evento no encontrado.', 404);
      }

      const hasExistingGoogle = Boolean(evRow.google_event_id && evRow.google_calendar_id);
      if (syncState.sync_direction !== 'bidirectional' && !hasExistingGoogle) {
        return jsonResponse({ ok: true, skipped: true, reason: 'import_only' });
      }

      const targetCalendarId = hasExistingGoogle
        ? evRow.google_calendar_id
        : (syncState.target_calendar_id || 'primary');
      const targetCalendarName = hasExistingGoogle
        ? (evRow.google_calendar_name || 'Principal')
        : (syncState.target_calendar_name || 'Principal');

      const payload = buildGoogleEventRequestBody(evRow);
      const { result: googleEv } = await withCalendarToken(candidates, async (cand) => {
        if (hasExistingGoogle) {
          return await calendarApiFetch<GoogleCalendarEventItem>(
            cand.token,
            `/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(evRow.google_event_id)}`,
            { method: 'PATCH', body: JSON.stringify(payload) },
          );
        }
        return await calendarApiFetch<GoogleCalendarEventItem>(
          cand.token,
          `/calendars/${encodeURIComponent(targetCalendarId)}/events`,
          { method: 'POST', body: JSON.stringify(payload) },
        );
      });

      if (googleEv.id) {
        await adminClient
          .from('eventos')
          .update({
            google_event_id: googleEv.id,
            google_calendar_id: targetCalendarId,
            google_calendar_name: targetCalendarName,
            google_etag: googleEv.etag || '',
            google_updated_at: googleEv.updated || new Date().toISOString(),
            google_html_link: googleEv.htmlLink || '',
            sync_owner_user_id: userId,
          })
          .eq('id', eventoId);
      }

      return jsonResponse({
        ok: true,
        google_event_id: googleEv.id || '',
        google_html_link: googleEv.htmlLink || '',
      });
    }

    if (action === 'delete-event') {
      const googleEventId = typeof body.google_event_id === 'string' ? body.google_event_id.trim() : '';
      const googleCalendarId = typeof body.google_calendar_id === 'string' ? body.google_calendar_id.trim() : '';
      if (!googleEventId || !googleCalendarId) {
        return jsonResponse({ ok: true, skipped: true });
      }

      try {
        await withCalendarToken(candidates, async (cand) => {
          await calendarApiFetch(
            cand.token,
            `/calendars/${encodeURIComponent(googleCalendarId)}/events/${encodeURIComponent(googleEventId)}`,
            { method: 'DELETE' },
          );
        });
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === 'no_encontrada') {
          return jsonResponse({ ok: true, already_deleted: true });
        }
        throw err;
      }

      return jsonResponse({ ok: true, deleted: true });
    }

    if (action === 'sync') {
      const syncState = await getOrInitCalendarSyncState(adminClient);
      const now = Date.now();
      const timeMinIso = new Date(now - 90 * 24 * 3600_000).toISOString();
      const timeMaxIso = new Date(now + 365 * 24 * 3600_000).toISOString();

      let selectedCalendars = normalizeSelectedCalendars(syncState.calendars);
      let resolvedEmail = '';

      if (selectedCalendars.length === 0) {
        const { result: available, used } = await withCalendarToken(
          candidates,
          (cand) => fetchGoogleCalendarList(cand.token),
        );
        resolvedEmail = used.email || '';
        const primaryCal = available.find((c) => c.primary) || available[0];
        if (primaryCal) {
          selectedCalendars = [{
            id: primaryCal.id,
            summary: primaryCal.summary,
            backgroundColor: primaryCal.backgroundColor,
            primary: primaryCal.primary,
            accessRole: primaryCal.accessRole,
          }];
          await adminClient.from('google_calendar_sync_state').upsert({
            id: 'global',
            calendars: selectedCalendars,
            target_calendar_id: primaryCal.writable ? primaryCal.id : 'primary',
            target_calendar_name: primaryCal.summary,
            actualizado: new Date().toISOString(),
          });
        }
      }

      let imported = 0;
      let updated = 0;
      let deleted = 0;
      let pushed = 0;
      const warnings: string[] = [];

      for (const cal of selectedCalendars) {
        let remoteEvents: GoogleCalendarEventItem[] = [];
        try {
          const { result, used } = await withCalendarToken(
            candidates,
            (cand) => fetchGoogleCalendarEvents(cand.token, cal.id, timeMinIso, timeMaxIso),
          );
          remoteEvents = result;
          if (!resolvedEmail && used.email) resolvedEmail = used.email;
        } catch (err) {
          if (err instanceof CalendarScopeError) throw err;
          warnings.push(`${cal.summary}: ${(err as Error).message}`);
          continue;
        }

        const { data: existingRows } = await adminClient
          .from('eventos')
          .select('id, google_event_id, google_etag, origen, etiqueta, inicio')
          .eq('google_calendar_id', cal.id);

        const existingByGoogleId = new Map<string, {
          id: number;
          google_event_id: string;
          google_etag: string;
          origen: string;
          etiqueta: string;
          inicio: string;
        }>();
        for (const row of existingRows ?? []) {
          if (row.google_event_id) existingByGoogleId.set(row.google_event_id, row);
        }

        const seenGoogleIds = new Set<string>();

        for (const gEv of remoteEvents) {
          if (!gEv.id || gEv.status === 'cancelled') continue;
          const bounds = parseGoogleEventBounds(gEv);
          if (!bounds) continue;

          seenGoogleIds.add(gEv.id);
          const existing = existingByGoogleId.get(gEv.id);
          const customLabel = gEv.extendedProperties?.private?.cemipre_etiqueta?.trim();
          const customOwner = gEv.extendedProperties?.private?.cemipre_responsable?.trim();
          const label = (customLabel || existing?.etiqueta || cal.summary || 'Google Calendar').slice(0, 60);
          const colorHex = (gEv.colorId && GOOGLE_EVENT_COLOR_HEX[gEv.colorId])
            || sanitizeHexColor(cal.backgroundColor)
            || '#4285f4';
          const owner = (
            customOwner
            || gEv.organizer?.displayName
            || gEv.creator?.displayName
            || cal.summary
            || 'Google Calendar'
          ).slice(0, 120);

          const rowPayload = {
            titulo: (gEv.summary || 'Sin título').trim().slice(0, 160) || 'Sin título',
            descripcion: (gEv.description || '').trim().slice(0, 2000),
            inicio: bounds.inicio,
            fin: bounds.fin,
            todo_el_dia: bounds.todo_el_dia,
            responsable: owner,
            etiqueta: label,
            color: colorHex,
            origen: existing?.origen === 'cemipre' ? 'cemipre' : 'google',
            google_event_id: gEv.id,
            google_calendar_id: cal.id,
            google_calendar_name: cal.summary.slice(0, 60),
            google_etag: gEv.etag || '',
            google_updated_at: gEv.updated || new Date().toISOString(),
            google_html_link: gEv.htmlLink || '',
            sync_owner_user_id: userId,
          };

          if (existing) {
            if (existing.google_etag !== rowPayload.google_etag) {
              const { error: updErr } = await adminClient
                .from('eventos')
                .update(rowPayload)
                .eq('id', existing.id);
              if (!updErr) updated += 1;
            }
          } else {
            const { error: insErr } = await adminClient
              .from('eventos')
              .insert(rowPayload);
            if (!insErr) imported += 1;
          }
        }

        // Eliminar eventos importados de Google que ya no existen en la ventana sincronizada
        const toDeleteIds: number[] = [];
        for (const [gId, row] of existingByGoogleId.entries()) {
          if (row.origen !== 'google') continue;
          if (seenGoogleIds.has(gId)) continue;
          const startMs = new Date(row.inicio).getTime();
          if (startMs >= new Date(timeMinIso).getTime() && startMs <= new Date(timeMaxIso).getTime()) {
            toDeleteIds.push(row.id);
          }
        }
        if (toDeleteIds.length > 0) {
          const { error: delErr } = await adminClient
            .from('eventos')
            .delete()
            .in('id', toDeleteIds);
          if (!delErr) deleted += toDeleteIds.length;
        }
      }

      // En modo bidireccional, publicar eventos creados en CEMIPRE que aún no están en Google Calendar
      const shouldPushLocal = syncState.sync_direction === 'bidirectional' && body.push_local !== false;
      if (shouldPushLocal) {
        const targetCalId = syncState.target_calendar_id || selectedCalendars[0]?.id || 'primary';
        const targetCalName = syncState.target_calendar_name
          || selectedCalendars.find((c) => c.id === targetCalId)?.summary
          || 'Principal';

        const { data: localPending } = await adminClient
          .from('eventos')
          .select('id, titulo, descripcion, inicio, fin, responsable, etiqueta')
          .eq('origen', 'cemipre')
          .eq('google_event_id', '')
          .gte('inicio', timeMinIso)
          .lte('inicio', timeMaxIso)
          .limit(50);

        for (const localEv of localPending ?? []) {
          try {
            const payload = buildGoogleEventRequestBody(localEv);
            const { result: createdGoogle } = await withCalendarToken(candidates, (cand) =>
              calendarApiFetch<GoogleCalendarEventItem>(
                cand.token,
                `/calendars/${encodeURIComponent(targetCalId)}/events`,
                { method: 'POST', body: JSON.stringify(payload) },
              ),
            );
            if (createdGoogle.id) {
              await adminClient
                .from('eventos')
                .update({
                  google_event_id: createdGoogle.id,
                  google_calendar_id: targetCalId,
                  google_calendar_name: targetCalName,
                  google_etag: createdGoogle.etag || '',
                  google_updated_at: createdGoogle.updated || new Date().toISOString(),
                  google_html_link: createdGoogle.htmlLink || '',
                  sync_owner_user_id: userId,
                })
                .eq('id', localEv.id);
              pushed += 1;
            }
          } catch (err) {
            warnings.push(`No se pudo publicar "${localEv.titulo}": ${(err as Error).message}`);
            break;
          }
        }
      }

      const nowIso = new Date().toISOString();
      const statusText = warnings.length > 0
        ? `Sincronizado con advertencias (${imported} nuevos, ${updated} actualizados, ${pushed} enviados).`
        : `Sincronizado (${imported} nuevos, ${updated} actualizados, ${deleted} eliminados, ${pushed} enviados a Google).`;

      await adminClient.from('google_calendar_sync_state').upsert({
        id: 'global',
        calendars: selectedCalendars,
        ultima_sincronizacion: nowIso,
        ultimo_estado: statusText,
        actualizado: nowIso,
      });

      if (imported > 0 || updated > 0 || deleted > 0 || pushed > 0) {
        await adminClient.from('actividad').insert({
          descripcion: `Sincronizó Google Calendar (${imported} nuevos, ${updated} actualizados, ${pushed} publicados).`,
          actor_id: userId,
          actor_nombre: perfil.nombre || perfil.email,
        });
      }

      return jsonResponse({
        ok: true,
        google_email: resolvedEmail,
        calendarios_sincronizados: selectedCalendars.length,
        importados: imported,
        actualizados: updated,
        eliminados: deleted,
        enviados_a_google: pushed,
        warnings,
        ultima_sincronizacion: nowIso,
        ultimo_estado: statusText,
      });
    }

    return errorResponse('Acción no soportada en sync-google-calendar.', 400);
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.status);
    }
    if (err instanceof CalendarScopeError) {
      return errorResponse(err.message, err.status, { code: err.code });
    }
    if (err instanceof GoogleApiError) {
      return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502, {
        code: err.code,
      });
    }
    return errorResponse(`Error en sync-google-calendar: ${(err as Error).message}`, 500);
  }
});
