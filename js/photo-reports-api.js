const BUCKET = "photo-reports";
const INDEX_FILE = "index.json";
const INDEX_VERSION = 1;

const RU_TRANSLIT_MAP = {
  "а": "a",
  "б": "b",
  "в": "v",
  "г": "g",
  "д": "d",
  "е": "e",
  "ё": "yo",
  "ж": "zh",
  "з": "z",
  "и": "i",
  "й": "y",
  "к": "k",
  "л": "l",
  "м": "m",
  "н": "n",
  "о": "o",
  "п": "p",
  "р": "r",
  "с": "s",
  "т": "t",
  "у": "u",
  "ф": "f",
  "х": "h",
  "ц": "ts",
  "ч": "ch",
  "ш": "sh",
  "щ": "sch",
  "ъ": "",
  "ы": "y",
  "ь": "",
  "э": "e",
  "ю": "yu",
  "я": "ya"
};

function transliterate(value) {
  return (value || "").split("").map((char) => {
    const lower = char.toLowerCase();
    const mapped = RU_TRANSLIT_MAP[lower];
    if (!mapped) return char;
    const replacement = mapped;
    return char === lower ? replacement : replacement.toUpperCase();
  }).join("");
}

function ensureSupabase() {
  const client = window.sb;
  if (!client) {
    throw new Error("Supabase client не инициализирован. Убедитесь, что подключён js/supabaseClient.js.");
  }
  return client;
}

function getStorage() {
  return ensureSupabase().storage.from(BUCKET);
}

function objectPrefix(objectId) {
  return `object_${objectId}`;
}

function sessionPrefix(objectId, sessionId) {
  return `${objectPrefix(objectId)}/${sessionId}`;
}

async function downloadJson(path) {
  const storage = getStorage();
  const { data, error } = await storage.download(path);
  if (error) {
    error.path = path;
    throw error;
  }
  const text = await data.text();
  return JSON.parse(text);
}

async function tryDownloadJson(path) {
  try {
    return await downloadJson(path);
  } catch (error) {
    if (error?.statusCode === "404" || error?.status === 404) {
      return null;
    }
    if (error?.message && /object not found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function uploadJson(path, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json; charset=utf-8"
  });
  const storage = getStorage();
  const { error } = await storage.upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) {
    error.path = path;
    throw error;
  }
}

function mapIndexSessions(index) {
  if (!index || typeof index !== "object" || !Array.isArray(index.sessions)) {
    return null;
  }
  const sessions = index.sessions.map((session) => ({
    session_id: session.session_id,
    title: session.title || session.session_id,
    period_start: session.period_start || null,
    period_end: session.period_end || null,
    count: Number(session.count) || 0,
    last_update: session.last_update || null,
    cover_path: session.cover_path || null,
    created_at: session.created_at || null
  }));
  const totalCount = typeof index.total_count === "number"
    ? index.total_count
    : sessions.reduce((sum, item) => sum + item.count, 0);
  const lastUpdated = index.updated_at || sessions.reduce((latest, item) => {
    if (!item.last_update) return latest;
    return !latest || latest < item.last_update ? item.last_update : latest;
  }, null);
  return {
    version: index.version || INDEX_VERSION,
    updated_at: lastUpdated,
    total_count: totalCount,
    sessions: sessions.sort((a, b) => {
      const aTime = a.last_update || a.created_at || "";
      const bTime = b.last_update || b.created_at || "";
      if (aTime && bTime) return bTime.localeCompare(aTime);
      if (aTime) return -1;
      if (bTime) return 1;
      return a.session_id.localeCompare(b.session_id);
    })
  };
}

function normalizeFilename(name) {
  return transliterate(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9a-zA-Z._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.-+/, "")
    .replace(/^-+/, "")
    .slice(0, 120) || "file";
}

function toSequentialName(index, extension) {
  return `${String(index + 1).padStart(4, "0")}__${extension}`;
}

function joinPath(...parts) {
  return parts.filter(Boolean).join("/");
}

export async function fetchActiveObjects() {
  const client = ensureSupabase();
  const { data, error } = await client
    .from("objects")
    .select("id, title, status")
    .eq("status", "активен")
    .order("title", { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function listSessionsFromStorage(objectId) {
  const prefix = objectPrefix(objectId);
  const storage = getStorage();
  const { data: entries, error } = await storage.list(prefix, { limit: 1000 });
  if (error) throw error;

  const sessionIds = (entries || [])
    .map((entry) => entry?.name || "")
    .filter((name) => name && name !== INDEX_FILE);

  const sessions = [];
  for (const sessionId of sessionIds) {
    const manifest = await tryDownloadJson(joinPath(prefix, sessionId, "manifest.json"));
    const { data: files, error: listError } = await storage.list(joinPath(prefix, sessionId), { limit: 1000 });
    if (listError) throw listError;
    const media = (files || []).filter((file) => file?.name && file.name !== "manifest.json");
    media.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const cover = media.length ? joinPath(prefix, sessionId, media[0].name) : null;
    const lastUpdate = manifest?.created_at || media[media.length - 1]?.updated_at || media[media.length - 1]?.created_at || null;

    sessions.push({
      session_id: sessionId,
      title: manifest?.title || sessionId,
      period_start: manifest?.period_start || null,
      period_end: manifest?.period_end || null,
      count: media.length,
      last_update: lastUpdate,
      cover_path: cover,
      created_at: manifest?.created_at || media[0]?.created_at || null
    });
  }

  const totalCount = sessions.reduce((sum, session) => sum + session.count, 0);
  const updatedAt = sessions.reduce((latest, session) => {
    if (!session.last_update) return latest;
    return !latest || latest < session.last_update ? session.last_update : latest;
  }, null);

  return {
    version: INDEX_VERSION,
    updated_at: updatedAt,
    total_count: totalCount,
    sessions: sessions.sort((a, b) => {
      const aTime = a.last_update || a.created_at || "";
      const bTime = b.last_update || b.created_at || "";
      if (aTime && bTime) return bTime.localeCompare(aTime);
      if (aTime) return -1;
      if (bTime) return 1;
      return b.session_id.localeCompare(a.session_id);
    })
  };
}

export async function fetchObjectSummary(objectId) {
  const prefix = objectPrefix(objectId);
  const index = await tryDownloadJson(joinPath(prefix, INDEX_FILE));
  if (index) {
    const mapped = mapIndexSessions(index);
    if (mapped) return mapped;
  }
  return listSessionsFromStorage(objectId);
}

export function getPublicUrl(path) {
  if (!path) return null;
  const client = ensureSupabase();
  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

export async function fetchSessionManifest(objectId, sessionId) {
  return tryDownloadJson(joinPath(sessionPrefix(objectId, sessionId), "manifest.json"));
}

export async function listSessionFiles(objectId, sessionId) {
  const storage = getStorage();
  const prefix = sessionPrefix(objectId, sessionId);
  const { data, error } = await storage.list(prefix, { limit: 1000 });
  if (error) throw error;
  const files = (data || []).filter((file) => file?.name && file.name !== "manifest.json");
  files.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return files.map((file) => {
    const path = joinPath(prefix, file.name);
    const { data: pub } = storage.getPublicUrl(path);
    return {
      name: file.name,
      size: file.metadata?.size || file.size || null,
      created_at: file.created_at || null,
      updated_at: file.updated_at || null,
      path,
      publicUrl: pub?.publicUrl || null,
      mimeType: file.metadata?.mimetype || null
    };
  });
}

export function generateSessionId(title, periodStart) {
  const baseDate = (() => {
    if (!periodStart) return null;
    const date = new Date(periodStart);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  })();
  const slug = transliterate(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "session";
  if (baseDate) return `${baseDate}-${slug}`;
  return `${Date.now().toString(36)}-${slug}`;
}

function makeSequentialFiles(files) {
  return files.map((file, index) => {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const rawName = normalizeFilename(file.name.replace(/\.[^.]+$/, "")) || "file";
    const filename = `${toSequentialName(index, `${rawName}${ext ? `.${ext}` : ""}`)}`;
    return new File([file], filename, { type: file.type });
  });
}

export async function createSession(objectId, { title, periodStart, periodEnd, files }, { onProgress } = {}) {
  if (!files?.length) {
    throw new Error("Выберите хотя бы один файл для загрузки.");
  }
  const storage = getStorage();
  const sessionId = generateSessionId(title, periodStart);
  const prefix = sessionPrefix(objectId, sessionId);
  const sequentialFiles = makeSequentialFiles(files);
  let uploaded = 0;
  const total = sequentialFiles.length + 1; // включая manifest

  for (const file of sequentialFiles) {
    const path = joinPath(prefix, file.name);
    const { error } = await storage.upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw error;
    uploaded += 1;
    if (typeof onProgress === "function") onProgress({ uploaded, total });
  }

  const manifest = {
    title: title || sessionId,
    period_start: periodStart || null,
    period_end: periodEnd || null,
    created_at: new Date().toISOString()
  };
  await uploadJson(joinPath(prefix, "manifest.json"), manifest);
  uploaded += 1;
  if (typeof onProgress === "function") onProgress({ uploaded, total });

  const summary = await listSessionsFromStorage(objectId);
  await uploadJson(joinPath(objectPrefix(objectId), INDEX_FILE), summary);
  const entry = summary.sessions.find((item) => item.session_id === sessionId) || null;
  return { sessionId, entry, index: summary };
}

export async function appendFilesToSession(objectId, sessionId, files, { onProgress } = {}) {
  if (!files?.length) {
    throw new Error("Выберите файлы для загрузки.");
  }
  const storage = getStorage();
  const prefix = sessionPrefix(objectId, sessionId);
  const summary = await fetchObjectSummary(objectId);
  const existing = summary.sessions.find((session) => session.session_id === sessionId);
  const existingCount = existing?.count || 0;

  const orderedFiles = files.map((file) => file).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  let uploaded = 0;
  const total = orderedFiles.length;
  let index = existingCount;

  for (const file of orderedFiles) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const base = normalizeFilename(file.name.replace(/\.[^.]+$/, "")) || "file";
    const filename = `${String(index + 1).padStart(4, "0")}__${base}${ext ? `.${ext}` : ""}`;
    index += 1;
    const renamed = new File([file], filename, { type: file.type });
    const path = joinPath(prefix, renamed.name);
    const { error } = await storage.upload(path, renamed, { upsert: false, contentType: renamed.type || undefined });
    if (error) throw error;
    uploaded += 1;
    if (typeof onProgress === "function") onProgress({ uploaded, total });
  }

  const refreshed = await listSessionsFromStorage(objectId);
  await uploadJson(joinPath(objectPrefix(objectId), INDEX_FILE), refreshed);
  return refreshed;
}
