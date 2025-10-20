const sb = window.sb;

if (!sb) {
  console.error('[documents-api] Supabase client not found. Ensure js/supabaseClient.js executed.');
}

function ensureClient(){
  if (!sb) throw new Error('Supabase client not initialized');
  return sb;
}

const uploadCache = new Map();

function buildSignature(file, category, subtype, folder){
  const baseScope = [category || "general", subtype || "common"].join("::");
  const scope = folder ? `${folder}::${baseScope}` : baseScope;
  const name = file?.name || "file";
  const size = file?.size ?? 0;
  const modified = file?.lastModified ?? 0;
  return `${scope}::${name}::${size}::${modified}`;
}

function sanitizeFilename(name = ""){
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  const rawBase = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  const rawExt = dotIndex > 0 ? trimmed.slice(dotIndex + 1) : "";

  const normalizeAscii = (value)=>{
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^0-9A-Za-z_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  const base = normalizeAscii(rawBase) || "document";
  const ext = normalizeAscii(rawExt).toLowerCase();

  const safe = ext ? `${base}.${ext}` : base;
  return safe.slice(0, 120);
}

export function publicUrl(path){
  if (!path) return null;
  const client = ensureClient();
  return client.storage.from('documents').getPublicUrl(path).data.publicUrl;
}

export async function uploadFile(file, category, subtype, options = {}){
  if (!file) throw new Error('Файл не выбран');
  const {
    force = false,
    folder: folderOverride,
    absolute: absolutePath = false
  } = options;
  const client = ensureClient();
  const signature = force ? null : buildSignature(file, category, subtype, folderOverride);

  if (signature && uploadCache.has(signature)){
    return uploadCache.get(signature);
  }

  const now = new Date();
  let folder;
  if (folderOverride){
    folder = folderOverride
      .replace(/^\/*/, '')
      .replace(/\/*$/, '');
    folder = folder || "gph";
  } else {
    folder = `${category || 'general'}/${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  const safeName = sanitizeFilename(file.name);
  const keyPrefix = absolutePath ? '' : 'documents/';
  const key = `${keyPrefix}${folder}/${crypto.randomUUID()}_${safeName}`;
  const { error } = await client.storage.from('documents').upload(key, file);
  if (error) {
    console.error('[documents-api] uploadFile error', error);
    throw error;
  }
  const meta = {
    path: key,
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedAt: now.toISOString()
  };

  if (signature){
    uploadCache.set(signature, meta);
  }

  return meta;
}

export async function createDoc(payload, options = {}){
  const { table = "request_documents" } = options || {};
  const client = ensureClient();
  const { data, error } = await client
    .from(table)
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    console.error('[documents-api] createDoc error', error?.message || error, error);
    throw error;
  }
  return data;
}

export async function updateDoc(id, patch, options = {}){
  const { table = "request_documents" } = options || {};
  const client = ensureClient();
  const { data, error } = await client
    .from(table)
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    console.error('[documents-api] updateDoc error', error?.message || error, error);
    throw error;
  }
  return data;
}

export async function fetchDocs({ q, category, status, from, to, table } = {}){
  const tableName = table || 'request_documents';
  const client = ensureClient();
  let qry = client
    .from(tableName)
    .select('*')
    .order('created_at', { ascending: false });

  if (q)       qry = qry.or(`title.ilike.%${q}%,number.ilike.%${q}%`);
  if (category && tableName === 'request_documents') qry = qry.eq('category', category);
  if (status)   qry = qry.eq('status', status);
  if (from)     qry = qry.gte('doc_date', from);
  if (to)       qry = qry.lte('doc_date', to);

  const { data, error } = await qry;
  if (error) {
    console.error('[documents-api] fetchDocs error', error);
    throw error;
  }
  const rows = Array.isArray(data) ? data : [];
  const authorIds = Array.from(new Set(
    rows
      .map(row => row?.created_by)
      .filter(Boolean)
  ));
  if (authorIds.length){
    const { data: profiles, error: profileError } = await client
      .from('profiles')
      .select('id, full_name, login')
      .in('id', authorIds);
    if (!profileError && Array.isArray(profiles)){
      const map = new Map(profiles.map(profile => [profile.id, profile]));
      rows.forEach(row => {
        const profile = map.get(row.created_by);
        if (profile){
          row._author_profile = profile;
        }
      });
    }else if (profileError){
      console.warn('[documents-api] fetchDocs author profiles error', profileError);
    }
  }
  return rows;
}

export async function fetchDocById(id, options = {}){
  const { table = "request_documents" } = options || {};
  const client = ensureClient();
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    console.error('[documents-api] fetchDocById error', error);
    throw error;
  }
  return data;
}

// Нормализация и сортировка на клиенте
function normalizeAndSort(rows){
  const arr = (rows || []).map(row => {
    const name = (row.name ?? row.title ?? '').trim() || '(без названия)';
    return { ...row, name };
  });
  arr.sort((a, b)=>a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
  return arr;
}

export async function fetchObjects(q){
  const client = ensureClient();
  const sel = 'id, name, title';
  let qry = client.from('objects').select(sel);
  if (q) qry = qry.or(`name.ilike.%${q}%,title.ilike.%${q}%`);
  const { data, error } = await qry;
  if (error){
    console.error('[documents-api] fetchObjects error', error);
    throw error;
  }
  return normalizeAndSort(data);
}

export async function fetchCounterparties(q, options = {}){
  if (typeof q === "object" && q !== null){
    options = q;
    q = options.q ?? null;
  }
  const { type, status } = options || {};
  const client = ensureClient();
  const sel = 'id, name, title, type';
  let qry = client.from('counterparties').select(sel);
  if (q) qry = qry.or(`name.ilike.%${q}%,title.ilike.%${q}%`);
  if (type) qry = qry.eq('type', type);
  if (status) qry = qry.eq('status', status);
  const { data, error } = await qry;
  if (error){
    console.error('[documents-api] fetchCounterparties error', error);
    throw error;
  }
  return normalizeAndSort(data);
}

export async function fetchCounterpartyDetails(id){
  if (!id) return null;
  const client = ensureClient();
  const { data, error } = await client
    .from('counterparties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error){
    console.error('[documents-api] fetchCounterpartyDetails error', error);
    throw error;
  }
  return data || null;
}

// Утилита для заполнения <select>
export function fillSelect(selectEl, rows, placeholder='— выбрать —'){
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);
  for (const r of rows){
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.name;
    selectEl.appendChild(o);
  }
}

export async function nameById(table, id){
  if (!id) return null;
  const client = ensureClient();
  const { data, error } = await client.from(table).select('name').eq('id', id).maybeSingle();
  if (error) {
    console.error('[documents-api] nameById error', error);
    throw error;
  }
  return data?.name || null;
}

export function normalizeAmount(value){
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value)
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(',', '.');
  return Number(cleaned);
}

export function normalizeDate(value){
  return value || null;
}
