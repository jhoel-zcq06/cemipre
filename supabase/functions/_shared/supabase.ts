import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface WorkerPerfil {
  id: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'trabajador' | 'pendiente';
  recibir_notificaciones: boolean;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new AuthError('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor.', 500);
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireAuthorizedWorker(req: Request): Promise<{
  userId: string;
  perfil: WorkerPerfil;
  adminClient: SupabaseClient;
}> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new AuthError('Falta configuración de Supabase Auth en Edge Functions.', 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new AuthError('Se requiere sesión autenticada (token JWT faltante).', 401);
  }

  const jwt = authHeader.slice(7).trim();
  if (!jwt) {
    throw new AuthError('Token JWT vacío.', 401);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData?.user) {
    throw new AuthError('Sesión inválida o expirada. Vuelve a iniciar sesión.', 401);
  }

  const adminClient = getSupabaseAdmin();
  const { data: perfil, error: perfilError } = await adminClient
    .from('perfiles')
    .select('id, email, nombre, rol, recibir_notificaciones')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (perfilError || !perfil) {
    throw new AuthError('No se encontró perfil de trabajador asociado.', 403);
  }

  if (perfil.rol !== 'admin' && perfil.rol !== 'trabajador') {
    throw new AuthError('Tu cuenta aún está pendiente de aprobación por un administrador.', 403);
  }

  return {
    userId: userData.user.id,
    perfil: perfil as WorkerPerfil,
    adminClient,
  };
}
