// ProStroy · Shared Header (soft-auth)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// — настройки ДОЛЖНЫ совпадать с index.html/main.html
const SUPABASE_URL  = "https://hvpbwpegxcbstmpngdyc.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2cGJ3cGVneGNic3RtcG5nZHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2NDE4NjMsImV4cCI6MjA3NDIxNzg2M30.rtPrQVsaEFA-ee1RphLKKn8q3TSOXeapZnZgfe9HVws";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    storageKey: "prostroy.auth",
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// — утилиты
function highlightActiveLink(root=document){
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  root.querySelectorAll(".ps-link").forEach(a=>{
    const file = (a.getAttribute("href")||"").split("/").pop()?.toLowerCase();
    if (file === here) a.classList.add("is-active");
  });
}

async function getSessionSoft(){
  // двойная попытка (гидратация может занять тик)
  let { data:{ session } } = await supabase.auth.getSession();
  if (!session){
    await new Promise(r=>setTimeout(r, 50));
    ({ data:{ session } } = await supabase.auth.getSession());
  }
  return session;
}

async function resolveDisplayName(user) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, login")
      .eq("id", user.id)
      .maybeSingle();

    if (!error && data) {
      if (data.full_name && data.full_name.trim()) {
        return data.full_name; // 👉 берём именно ФИО
      }
      if (data.login && data.login.trim()) {
        return data.login;     // fallback на логин
      }
    }
  } catch (_) {}

  // если в profiles пусто — fallback на user_metadata или email
  const meta =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.login;
  return meta || user.email || "Пользователь";
}

async function renderUser(root=document){
  const el = root.getElementById ? root.getElementById("ps-user-name") : document.getElementById("ps-user-name");
  if (!el) return;
  el.textContent = "Загрузка…";
  const session = await getSessionSoft();
  if (!session){ el.textContent = "Гость"; return; } // ⬅ без редиректа
  el.textContent = await resolveDisplayName(session.user);
}

function bindActions(root=document){
  const btnLogout = root.getElementById ? root.getElementById("ps-logout") : document.getElementById("ps-logout");
  if (btnLogout){
    btnLogout.addEventListener("click", async ()=>{
      try{ await supabase.auth.signOut(); }catch(_){}
      // редирект делать не здесь — main.html сам проверит и отправит на логин
      location.reload(); // обновим страницу, main.html увидит отсутствие сессии и утащит на index.html
    });
  }
  supabase.auth.onAuthStateChange((_evt, session)=>{
    // без прямых редиректов: просто перерисуем имя
    if (session) renderUser(root);
  });
}

export async function loadHeader(){
  const mount = document.getElementById("header-mount");
  if (!mount){ console.warn("[ProStroy] #header-mount не найден"); return; }
  const resp = await fetch("./header.html", { cache: "no-cache" });
  mount.innerHTML = await resp.text();

  highlightActiveLink(mount.ownerDocument);
  bindActions(mount.ownerDocument);
  await renderUser(mount.ownerDocument);
}

// автозапуск
if (typeof window !== "undefined"){
  loadHeader().catch(console.error);
}
