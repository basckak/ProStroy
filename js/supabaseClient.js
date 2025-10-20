(() => {
  const DEFAULT_URL = "https://hvpbwpegxcbstmpngdyc.supabase.co";
  const DEFAULT_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2cGJ3cGVneGNic3RtcG5nZHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2NDE4NjMsImV4cCI6MjA3NDIxNzg2M30.rtPrQVsaEFA-ee1RphLKKn8q3TSOXeapZnZgfe9HVws";

  const env = window.ENV || {};
  const url = env.SUPABASE_URL || DEFAULT_URL;
  const anon = env.SUPABASE_ANON_KEY || DEFAULT_ANON;

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[supabaseClient] Supabase UMD script is not loaded');
    return;
  }

  try {
    window.sb = window.supabase.createClient(url, anon, {
      auth: {
        persistSession: true,
        storageKey: 'prostroy.auth',
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  } catch (err){
    console.error('[supabaseClient] Failed to create client', err);
  }
})();
