const STORAGE_KEY = 'prostroy.auth';

function ensureClient(){
  if (window.sb) return window.sb;
  throw new Error('[supabaseClient] Supabase client не инициализирован. Убедитесь, что подключён /js/supabaseClient.js и window.ENV содержит ключи.');
}

export function getSupabaseClient(){
  return ensureClient();
}

export async function getSessionSoft(retryMs = 50){
  const client = ensureClient();
  let { data: { session } = { session: null } } = await client.auth.getSession();
  if (!session && retryMs){
    await new Promise(resolve => setTimeout(resolve, retryMs));
    ({ data: { session } = { session: null } } = await client.auth.getSession());
  }
  return session;
}

export async function requireSession({ redirectTo = './index.html' } = {}){
  const client = ensureClient();
  const { data: { session } = { session: null } } = await client.auth.getSession();
  if (!session){
    if (redirectTo){
      window.location.replace(redirectTo);
    }
    throw new Error('auth-required');
  }
  return session;
}

const supabaseProxy = new Proxy({}, {
  get(_target, prop){
    const client = ensureClient();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

export default supabaseProxy;
