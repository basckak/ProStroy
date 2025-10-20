import { requireSession } from "../supabaseClient.js";
import { uploadFile, createDoc, updateDoc, fetchDocById, publicUrl } from "../js/documents-api.js";

const headerReady = window.headerReady || Promise.resolve();

function qs(name){
  return new URLSearchParams(location.search).get(name);
}

function formatDateISO(value){
  if (!value) return "";
  return value.split("T")[0];
}

function escapeHtml(value){
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, ch => map[ch] || ch);
}

export default async function initDocumentForm(config){
  const { category, subtype, title, hint } = config;
  if (!category || !subtype){
    throw new Error('document-form: category и subtype обязательны');
  }

  await headerReady;
  await requireSession();

  const heading = document.getElementById('docFormTitle');
  const hintEl = document.getElementById('docFormHint');
  if (heading) heading.textContent = title || 'Создать документ';
  if (hintEl && hint) hintEl.textContent = hint;

  const formEl = document.getElementById('docForm');
  const saveBtn = document.getElementById('btnSaveDraft');
  const submitBtn = document.getElementById('btnSubmit');
  const fileInput = document.getElementById('file');
  const downloadLink = document.getElementById('currentFileLink');
  const statusSelect = document.getElementById('status');
  const messageEl = document.getElementById('formMessage');

  const docId = qs('id');
  let existingDoc = null;
  if (docId){
    await loadExisting(docId);
  }

  saveBtn?.addEventListener('click', async (event)=>{
    event.preventDefault();
    await handleSubmit('draft');
  });

  submitBtn?.addEventListener('click', async (event)=>{
    event.preventDefault();
    await handleSubmit('in_review');
  });

  async function loadExisting(id){
    try {
      existingDoc = await fetchDocById(id);
      if (!existingDoc){
        message('Документ не найден', true);
        return;
      }
      if (heading){
        heading.textContent = title ? `Редактировать: ${title}` : 'Редактировать документ';
      }
      if (statusSelect) statusSelect.value = existingDoc.status || 'draft';
      fillField('title', existingDoc.title);
      fillField('number', existingDoc.number);
      fillField('doc_date', formatDateISO(existingDoc.doc_date));
      fillField('amount', existingDoc.amount);
      fillField('notes', existingDoc.notes);
      if (existingDoc.file_path && downloadLink){
        const url = await publicUrl(existingDoc.file_path);
        if (url){
          downloadLink.innerHTML = `Текущий файл: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(existingDoc.file_name || 'скачать')}</a>`;
        }
      }
    } catch (err){
      console.error('document-form loadExisting', err);
      message('Не удалось загрузить документ', true);
    }
  }

  function fillField(id, value){
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  }

  function collectForm(){
    const data = Object.fromEntries(new FormData(formEl).entries());
    return {
      title: data.title?.trim() || null,
      number: data.number?.trim() || null,
      doc_date: data.doc_date || null,
      amount: data.amount ? Number(data.amount) : null,
      notes: data.notes?.trim() || null,
      status: data.status || 'draft'
    };
  }

  async function handleSubmit(targetStatus){
    try {
      setBusy(true);
      message('');
      const base = collectForm();
      const file = fileInput?.files?.[0] || null;
      const isNew = !existingDoc;

      let fileMeta = null;
      if (file){
        fileMeta = await uploadFile(file, category, subtype);
      } else if (!isNew){
        fileMeta = existingDoc && existingDoc.file_path ? {
          path: existingDoc.file_path,
          name: existingDoc.file_name,
          size: existingDoc.file_size,
          type: existingDoc.file_type
        } : null;
      } else {
        message('Пожалуйста, выберите файл', true);
        setBusy(false);
        return;
      }

      const payload = {
        category,
        subtype,
        title: base.title,
        number: base.number,
        doc_date: base.doc_date,
        amount: base.amount,
        notes: base.notes,
        status: targetStatus,
        file_path: fileMeta?.path || null,
        file_name: fileMeta?.name || null,
        file_size: fileMeta?.size || null,
        file_type: fileMeta?.type || null
      };

      let doc;
      if (existingDoc){
        doc = await updateDoc(existingDoc.id, payload);
      } else {
        doc = await createDoc(payload);
      }
      existingDoc = doc;

      if (statusSelect) statusSelect.value = targetStatus;

      const url = new URL('/documents.html', location.origin);
      if (doc?.id) url.searchParams.set('justCreated', doc.id);
      location.href = url.pathname + url.search;
    } catch (err){
      console.error('document-form handleSubmit', err);
      message('Не удалось сохранить документ. Проверьте заполненные данные.', true);
    } finally {
      setBusy(false);
    }
  }

  function message(text, isError = false){
    if (!messageEl) return;
    if (!text){ messageEl.textContent=''; messageEl.style.display='none'; return; }
    messageEl.textContent = text;
    messageEl.className = isError ? 'err' : 'ok';
    messageEl.style.display = 'block';
  }

  function setBusy(state){
    [saveBtn, submitBtn].forEach(btn => {
      if (!btn) return;
      if (!btn.dataset.label){
        btn.dataset.label = btn.textContent;
      }
      btn.disabled = state;
      if (state){
        const busyText = btn.dataset.busyText || (btn === submitBtn ? 'Отправляем…' : 'Сохраняем…');
        btn.textContent = busyText;
      } else {
        btn.textContent = btn.dataset.label;
      }
    });
  }

  if (saveBtn && !saveBtn.dataset.busyText){
    saveBtn.dataset.busyText = 'Сохраняем…';
  }
  if (submitBtn && !submitBtn.dataset.busyText){
    submitBtn.dataset.busyText = 'Отправляем…';
  }
}
