/**
 * Puente de Google Apps Script para crear carpetas y Google Docs en "Mi unidad" (@gmail.com)
 * sin chocar con el límite de 0 GB de cuota de las Service Accounts.
 *
 * Pasos para desplegar en la cuenta Google dueña de la carpeta raíz de CEMIPRE:
 * 1. Abre https://script.google.com y crea un proyecto nuevo (ej.: "CEMIPRE Drive Bridge").
 * 2. Pega todo este archivo en Código.gs.
 * 3. En Configuración del proyecto (engranaje) -> Propiedades de la secuencia de comandos,
 *    agrega la propiedad:
 *      CEMIPRE_DRIVE_SECRET = <el mismo valor que pondrás en GOOGLE_DRIVE_WEBHOOK_SECRET en Supabase>
 * 4. Haz clic en Implementar -> Nueva implementación -> Tipo: "Aplicación web":
 *    - Ejecutar como: "Yo" (tu cuenta de Google dueña de la carpeta)
 *    - Quién tiene acceso: "Cualquier usuario"
 * 5. Copia la URL /exec resultante y guárdala en Supabase Edge Function Secrets como:
 *    GOOGLE_DRIVE_WEBHOOK_URL y GOOGLE_DRIVE_WEBHOOK_SECRET.
 */

var FALLBACK_SECRET = 'CAMBIA_ESTE_SECRETO_EN_PROPIEDADES';

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getExpectedSecret() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('CEMIPRE_DRIVE_SECRET');
  if (fromProps && String(fromProps).trim()) {
    return String(fromProps).trim();
  }
  return FALLBACK_SECRET;
}

function findMatchingUserFolder(rootFolder, userCodigo, userNombre, fallbackName) {
  var codeLow = String(userCodigo || '').trim().toLowerCase();
  var nameLow = String(userNombre || '').trim().toLowerCase();
  var fullLow = String(fallbackName || '').trim().toLowerCase();

  var it = rootFolder.getFolders();
  while (it.hasNext()) {
    var sub = it.next();
    var subLow = String(sub.getName() || '').trim().toLowerCase();
    if (
      (fullLow && subLow === fullLow) ||
      (codeLow && (
        subLow === codeLow ||
        subLow.indexOf(codeLow + ' ') === 0 ||
        subLow.indexOf(codeLow + '-') === 0 ||
        subLow.indexOf(codeLow + '_') === 0
      )) ||
      (nameLow && subLow === nameLow)
    ) {
      return sub;
    }
  }
  return null;
}

function findReusableBitacoraFolder(userFolder, bitacoraName) {
  var it = userFolder.getFoldersByName(bitacoraName);
  while (it.hasNext()) {
    var existing = it.next();
    // Reutilizar solo si todavía no contiene un archivo adentro
    if (!existing.getFiles().hasNext()) {
      return existing;
    }
  }
  return userFolder.createFolder(bitacoraName);
}

function doGet() {
  return jsonOut({
    ok: true,
    service: 'CEMIPRE Drive Bridge',
    version: 1,
  });
}

function doPost(e) {
  try {
    var expected = getExpectedSecret();
    if (!expected || expected === 'CAMBIA_ESTE_SECRETO_EN_PROPIEDADES') {
      return jsonOut({
        ok: false,
        error: 'Configura la propiedad CEMIPRE_DRIVE_SECRET en Apps Script antes de usar el puente.',
      });
    }

    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    if (!body.secret || String(body.secret) !== expected) {
      return jsonOut({ ok: false, error: 'Secreto inválido en puente Apps Script.' });
    }

    var bitacoraName = String(body.bitacora_name || '').trim();
    if (!bitacoraName) {
      return jsonOut({ ok: false, error: 'Falta bitacora_name.' });
    }

    var userFolder = null;
    var userFolderId = String(body.user_folder_id || '').trim();
    var rootFolderId = String(body.root_folder_id || '').trim();

    if (userFolderId) {
      userFolder = DriveApp.getFolderById(userFolderId);
    } else if (rootFolderId) {
      var rootFolder = DriveApp.getFolderById(rootFolderId);
      var fallbackName = String(body.user_folder_name || body.user_nombre || body.user_codigo || 'Usuario').trim();
      userFolder = findMatchingUserFolder(rootFolder, body.user_codigo, body.user_nombre, fallbackName);
      if (!userFolder) {
        userFolder = rootFolder.createFolder(fallbackName);
      }
    } else {
      return jsonOut({ ok: false, error: 'Falta user_folder_id o root_folder_id.' });
    }

    var bitacoraFolder = findReusableBitacoraFolder(userFolder, bitacoraName);
    var doc = DocumentApp.create(bitacoraName);
    var docId = doc.getId();
    var docUrl = doc.getUrl();
    DriveApp.getFileById(docId).moveTo(bitacoraFolder);

    return jsonOut({
      ok: true,
      user_folder_id: userFolder.getId(),
      bitacora_folder_id: bitacoraFolder.getId(),
      doc_id: docId,
      doc_url: docUrl,
      doc_name: bitacoraName,
    });
  } catch (err) {
    return jsonOut({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
}
