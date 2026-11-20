import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { timingSafeEqual } from '../_shared/crypto.ts';
import {
  getStartPageToken,
  GoogleApiError,
  listDriveChanges,
  resolveDriveTokenCandidates,
} from '../_shared/google.ts';
import { getSupabaseAdmin } from '../_shared/supabase.ts';

interface BitacoraWithPersona {
  id: number;
  persona_id: number;
  titulo: string;
  google_doc_id: string;
  url_docs: string;
  drive_revision_id: string;
  personas: {
    id: number;
    codigo: string;
    nombre: string;
  } | null;
}

function formatChileTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAlertEmail(params: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const provider = (Deno.env.get('EMAIL_PROVIDER') || 'resend').trim().toLowerCase();
  const apiKey = (Deno.env.get('EMAIL_API_KEY') || '').trim();
  const from = (Deno.env.get('EMAIL_FROM') || 'CEMIPRE Bitácoras <notificaciones@cemipre.local>').trim();

  if (provider === 'webhook') {
    const webhookUrl = (Deno.env.get('EMAIL_WEBHOOK_URL') || '').trim();
    if (!webhookUrl) {
      return { ok: false, error: 'Falta EMAIL_WEBHOOK_URL para EMAIL_PROVIDER=webhook.' };
    }
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ from, ...params }),
    });
    if (!res.ok) {
      return { ok: false, error: `Webhook respondió ${res.status}` };
    }
    return { ok: true };
  }

  if (!apiKey) {
    return { ok: false, error: 'Falta configurar EMAIL_API_KEY (Resend) en secretos de Edge Functions.' };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (res.ok) {
      return { ok: true };
    }

    const body = await res.text();
    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfterSec = Number(res.headers.get('retry-after') || '0');
      const waitMs = retryAfterSec > 0 && retryAfterSec <= 10 ? retryAfterSec * 1000 : 1200 * attempt;
      await sleep(waitMs);
      continue;
    }

    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 180)}` };
  }

  return { ok: false, error: 'Resend 429: límite temporal de envíos superado.' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido. Usa POST.', 405);
  }

  const cronSecret = (Deno.env.get('CRON_SECRET') || '').trim();
  if (!cronSecret) {
    return errorResponse('CRON_SECRET no está configurado en el servidor.', 500);
  }

  const headerSecret = (req.headers.get('x-cron-secret') || '').trim();
  const authHeader = (req.headers.get('Authorization') || '').trim();
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const providedSecret = headerSecret || bearerSecret;

  if (!providedSecret || !timingSafeEqual(providedSecret, cronSecret)) {
    return errorResponse('No autorizado: CRON_SECRET inválido.', 401);
  }

  try {
    const adminClient = getSupabaseAdmin();
    const { candidates, reconnectNeeded, lastAuthError } = await resolveDriveTokenCandidates(adminClient, {
      preferInstitutional: true,
      includeServiceAccount: true,
    });

    if (candidates.length === 0) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: reconnectNeeded ? 'requiere_reconexion' : 'sin_credenciales_drive',
        message: lastAuthError || 'Conecta una cuenta Google Drive institucional para habilitar avisos.',
      });
    }

    const token = candidates[0].token;
    const debounceMinutes = Math.max(1, Number(Deno.env.get('NOTIFY_DEBOUNCE_MINUTES') || '15'));
    const appBaseUrl = (Deno.env.get('APP_BASE_URL') || 'https://cemipre-plataforma.vercel.app').replace(/\/$/, '');
    const isResendProvider = (Deno.env.get('EMAIL_PROVIDER') || 'resend').trim().toLowerCase() !== 'webhook';

    const { data: syncState, error: syncErr } = await adminClient
      .from('drive_sync_state')
      .select('id, start_page_token')
      .eq('id', 'global')
      .maybeSingle();

    if (syncErr) {
      return errorResponse(`Error consultando drive_sync_state: ${syncErr.message}`, 500);
    }

    const currentToken = (syncState?.start_page_token || '').trim();
    if (!currentToken) {
      const initialToken = await getStartPageToken(token);
      await adminClient.from('drive_sync_state').upsert({
        id: 'global',
        start_page_token: initialToken,
        ultima_sincronizacion: new Date().toISOString(),
        ultimo_estado: 'Sincronización de avisos inicializada.',
        actualizado: new Date().toISOString(),
      });
      return jsonResponse({ ok: true, initialized: true, start_page_token: initialToken });
    }

    let changesResult;
    try {
      changesResult = await listDriveChanges(currentToken, token);
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 410 || err.status === 400)) {
        const refreshedToken = await getStartPageToken(token);
        await adminClient.from('drive_sync_state').upsert({
          id: 'global',
          start_page_token: refreshedToken,
          ultima_sincronizacion: new Date().toISOString(),
          ultimo_estado: 'Sincronización de avisos actualizada.',
          actualizado: new Date().toISOString(),
        });
        return jsonResponse({ ok: true, token_refreshed: true });
      }
      throw err;
    }

    // Consolidar múltiples eventos sobre un mismo archivo dentro del lote
    const changedByFileId = new Map<string, {
      fileId: string;
      modifiedTime: string;
      headRevisionId: string;
      name?: string;
    }>();
    const trashedIds = new Set<string>();

    for (const ch of changesResult.changes) {
      if (!ch.fileId) continue;
      if (ch.removed || ch.file?.trashed) {
        trashedIds.add(ch.fileId);
        changedByFileId.delete(ch.fileId);
        continue;
      }
      trashedIds.delete(ch.fileId);
      changedByFileId.set(ch.fileId, {
        fileId: ch.fileId,
        modifiedTime: ch.file?.modifiedTime || ch.time || new Date().toISOString(),
        headRevisionId: ch.file?.headRevisionId || '',
        name: ch.file?.name,
      });
    }

    if (trashedIds.size > 0) {
      await adminClient
        .from('bitacoras')
        .update({ estado_sync: 'no_encontrada' })
        .in('google_doc_id', Array.from(trashedIds));
    }

    const changedIds = Array.from(changedByFileId.keys());
    let notificacionesEnviadas = 0;
    let notificacionesOmitidas = 0;
    let erroresEnvio = 0;
    let emailSendCount = 0;

    if (changedIds.length > 0) {
      const { data: matchedLogs } = await adminClient
        .from('bitacoras')
        .select('id, persona_id, titulo, google_doc_id, url_docs, drive_revision_id, personas(id, codigo, nombre)')
        .in('google_doc_id', changedIds);

      const bitacoras = (matchedLogs ?? []) as unknown as BitacoraWithPersona[];

      if (bitacoras.length > 0) {
        const { data: recipientsData } = await adminClient
          .from('perfiles')
          .select('email')
          .in('rol', ['admin', 'trabajador'])
          .eq('recibir_notificaciones', true);

        const recipientEmails = (recipientsData ?? [])
          .map((r: { email: string }) => r.email)
          .filter(Boolean);

        const cutoffIso = new Date(Date.now() - debounceMinutes * 60_000).toISOString();

        for (const b of bitacoras) {
          const change = changedByFileId.get(b.google_doc_id);
          if (!change) continue;

          const updatedTitle = change.name?.trim() ? change.name.trim().slice(0, 160) : b.titulo;

          // Actualizar metadatos de última edición (y renombre si corresponde)
          await adminClient
            .from('bitacoras')
            .update({
              titulo: updatedTitle,
              drive_modified_time: change.modifiedTime,
              drive_revision_id: change.headRevisionId || b.drive_revision_id,
              estado_sync: 'sincronizada',
            })
            .eq('id', b.id);

          // Control anti-spam por autoguardado frecuente de Google Docs
          const { data: recentSent } = await adminClient
            .from('notificaciones_enviadas')
            .select('id, drive_revision_id')
            .eq('bitacora_id', b.id)
            .eq('estado', 'enviada')
            .gte('enviada_en', cutoffIso)
            .limit(1);

          const sameRevisionAlreadyNotified = Boolean(
            change.headRevisionId && change.headRevisionId === b.drive_revision_id,
          );

          if ((recentSent && recentSent.length > 0) || sameRevisionAlreadyNotified) {
            notificacionesOmitidas++;
            await adminClient.from('notificaciones_enviadas').insert({
              bitacora_id: b.id,
              persona_id: b.persona_id,
              destinatario_email: 'equipo@agrupado',
              estado: 'omitida',
              detalle_error: 'Cambio agrupado por ventana anti-spam de autoguardado.',
              drive_revision_id: change.headRevisionId,
            });
            continue;
          }

          if (recipientEmails.length === 0) {
            notificacionesOmitidas++;
            await adminClient.from('notificaciones_enviadas').insert({
              bitacora_id: b.id,
              persona_id: b.persona_id,
              destinatario_email: 'sin-destinatarios',
              estado: 'omitida',
              detalle_error: 'No hay trabajadores con recibir_notificaciones=true.',
              drive_revision_id: change.headRevisionId,
            });
            continue;
          }

          const personaLabel = b.personas
            ? `${b.personas.codigo} · ${b.personas.nombre}`
            : `Persona #${b.persona_id}`;
          const fechaLegible = formatChileTime(change.modifiedTime);

          // IMPORTANTE (Privacidad): nunca incluir contenido clínico del Google Doc en el correo
          const subject = `[CEMIPRE] Bitácora actualizada: ${updatedTitle} (${b.personas?.codigo || b.persona_id})`;
          const textBody = [
            'Se detectó una actualización en Google Docs vinculada a la plataforma CEMIPRE.',
            '',
            `Usuario: ${personaLabel}`,
            `Bitácora: ${updatedTitle}`,
            `Última modificación: ${fechaLegible}`,
            '',
            `Abrir plataforma: ${appBaseUrl}`,
            ...(b.url_docs ? [`Abrir documento (requiere sesión con permisos): ${b.url_docs}`] : []),
            '',
            'Por seguridad y privacidad, este correo no incluye contenido de la bitácora.',
          ].join('\n');

          const htmlBody = `
            <div style="font-family:sans-serif;max-width:560px;line-height:1.5;color:#1b2433;">
              <h2 style="margin-bottom:8px;">Actualización de bitácora en CEMIPRE</h2>
              <p>Se detectó una edición reciente en un documento vinculado:</p>
              <ul>
                <li><strong>Usuario:</strong> ${escapeHtml(personaLabel)}</li>
                <li><strong>Bitácora:</strong> ${escapeHtml(updatedTitle)}</li>
                <li><strong>Fecha:</strong> ${escapeHtml(fechaLegible)}</li>
              </ul>
              <p>
                <a href="${escapeHtml(appBaseUrl)}" style="display:inline-block;padding:10px 16px;background:#4f6be8;color:#fff;text-decoration:none;border-radius:6px;">Ir a la plataforma CEMIPRE</a>
              </p>
              <p style="font-size:12px;color:#5c6b80;">Por privacidad clínica, el contenido del documento solo se consulta dentro de Google Docs o la plataforma autenticada.</p>
            </div>
          `;

          for (const email of recipientEmails) {
            if (emailSendCount > 0 && isResendProvider) {
              await sleep(600);
            }
            emailSendCount++;
            const sendResult = await sendAlertEmail({
              to: [email],
              subject,
              html: htmlBody,
              text: textBody,
            });

            if (sendResult.ok) {
              notificacionesEnviadas++;
              await adminClient.from('notificaciones_enviadas').insert({
                bitacora_id: b.id,
                persona_id: b.persona_id,
                destinatario_email: email,
                estado: 'enviada',
                drive_revision_id: change.headRevisionId,
              });
            } else {
              erroresEnvio++;
              await adminClient.from('notificaciones_enviadas').insert({
                bitacora_id: b.id,
                persona_id: b.persona_id,
                destinatario_email: email,
                estado: 'error',
                detalle_error: sendResult.error || 'Fallo desconocido al enviar correo.',
                drive_revision_id: change.headRevisionId,
              });
            }
          }
        }
      }
    }

    await adminClient.from('drive_sync_state').upsert({
      id: 'global',
      start_page_token: changesResult.newStartPageToken,
      ultima_sincronizacion: new Date().toISOString(),
      ultimo_estado: `Avisos revisados: ${changedIds.length} cambios, ${notificacionesEnviadas} enviados, ${notificacionesOmitidas} agrupados.`,
      actualizado: new Date().toISOString(),
    });

    return jsonResponse({
      ok: true,
      auth_source: candidates[0].source,
      cambios_en_drive: changedIds.length,
      notificaciones_enviadas: notificacionesEnviadas,
      notificaciones_omitidas: notificacionesOmitidas,
      errores_envio: erroresEnvio,
    });
  } catch (err) {
    return errorResponse(`Error en notificar-cambios: ${(err as Error).message}`, 500);
  }
});
