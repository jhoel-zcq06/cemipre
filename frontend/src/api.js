/** API local. Vite pasa /api a Django; no se requieren CORS ni credenciales cloud. */
function readCookie(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

async function request(path, { method = 'GET', body } = {}) {
  const changing = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (changing) {
    // Django exige token CSRF en cambios de estado.
    await fetch('/api/csrf/', { credentials: 'same-origin' });
  }
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(changing ? { 'X-CSRFToken': readCookie('csrftoken') } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Respuesta inesperada del servidor. ¿Está funcionando Django?');
  }
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
  return payload;
}

export const api = {
  users: () => request('/personas/'),
  user: (id) => request(`/personas/${id}/`),
  createUser: (body) => request('/personas/', { method: 'POST', body }),
  createLog: (body) => request('/bitacoras/', { method: 'POST', body }),
  updateLog: (id, body) => request(`/bitacoras/${id}/`, { method: 'PATCH', body }),
  summary: (id) => request(`/personas/${id}/resumen/`),
  events: () => request('/eventos/'),
  createEvent: (body) => request('/eventos/', { method: 'POST', body }),
  deleteEvent: (id) => request(`/eventos/${id}/`, { method: 'DELETE' }),
  activity: () => request('/actividad/'),
};
