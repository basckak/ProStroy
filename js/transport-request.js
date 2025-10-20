import supabase, { requireSession } from "../supabaseClient.js";
import { cachedFetch } from "../cache.js";
import { createApprovalPicker } from "../approvalPicker.js";
import { createApprovalFlow } from "../approvalFlow.js";

const headerReady = window.headerReady || Promise.resolve();

const byId = (id) => document.getElementById(id);

const form = byId("transportForm");
const formMessage = byId("formMessage");
const btnSave = byId("btnSave");
const btnSubmitApproval = byId("btnSubmitApproval");
const buttonRow = document.querySelector(".button-row");
const fileInput = byId("files");
const filesList = byId("files-list");
const approvalSection = byId("approvalSection");
const approvalBlockCard = byId("approvalBlockCard");
const approvalBlockHint = byId("approvalBlockHint");
const approverModal = byId("approverModal");
const approverModalClose = byId("approverModalClose");
const approverModalCancel = byId("approverModalCancel");
const approverModalApply = byId("approverModalApply");
const approverPickerField = byId("approverPickerField");

const objectSelect = byId("destination_object");
const objectInfo = byId("destination_object_info");

let currentSession = null;
let existingRequest = null;
let selectedFiles = [];

const objectDirectory = {
  list: [],
  map: new Map(),
  loading: true,
  error: null
};

const approvalPicker = createApprovalPicker({
  supabase,
  wrapper: "approversSelect",
  display: "approversDisplay",
  search: "approversSearch",
  options: "approversOptions",
  help: "approversHelp"
});

const approvalFlow = createApprovalFlow({
  docKind: "transport_request",
  tableName: "transport_requests",
  supabase,
  requireSession,
  approvalPicker,
  mountSection: "approvalSection",
  approverSection: "approverPickerField",
  buildTitle: (record)=>{
    if (!record) return "Заявка на автотранспорт";
    const parts = [];
    if (record.request_no){
      parts.push(`Заявка ${record.request_no}`);
    } else {
      parts.push("Заявка на автотранспорт");
    }
    if (record.destination){
      parts.push(record.destination);
    }
    return parts.join(" · ");
  },
  resolveObjectId: (_record)=> null,
  onApprovalEstablished: async (newApprovalId)=>{
    if (!existingRequest) existingRequest = {};
    existingRequest.approval_id = newApprovalId;
    if (existingRequest.id){
      try{
        await supabase
          .from("transport_requests")
          .update({ approval_id: newApprovalId })
          .eq("id", existingRequest.id);
      }catch(error){
        console.warn("[transport] failed to link approval_id", error);
      }
    }
    removeApprovalHint();
    closeApproverModal();
  },
  onApprovalRemoved: async ()=>{
    if (!existingRequest) existingRequest = {};
    existingRequest.approval_id = null;
    existingRequest.status = "черновик";
    if (existingRequest.id){
      try{
        await supabase
          .from("transport_requests")
          .update({ approval_id: null, status: "черновик" })
          .eq("id", existingRequest.id);
      }catch(error){
        console.warn("[transport] failed to reset approval_id", error);
      }
    }
    approvalPicker?.setSelected?.([]);
    approvalPicker?.reset?.();
    showApprovalCard();
    showMessage("Согласование удалено. Назначьте новых согласующих.", false);
    toggleActionButtons(existingRequest.status);
  }
});

approvalFlow.hideApproverSection();

init().catch(error=>{
  console.error("[transport] init failed", error);
  showMessage("Не удалось инициализировать форму. Перезагрузите страницу.", true);
});

async function init(){
  await headerReady;
  currentSession = await requireSession({ redirectTo: "./index.html" });

  bindEvents();
  renderFilesList();

  const params = new URLSearchParams(location.search);
  const requestId = params.get("id");

  await Promise.all([
    loadObjectDirectory(),
    approvalPicker.loadDirectory().catch(error=>{
      console.warn("[transport] approver directory load failed", error);
    })
  ]);

  if (requestId){
    try{
      const record = await loadExisting(requestId);
      if (record){
        existingRequest = record;
        populateForm(record);
        toggleActionButtons(record.status);
        if (Array.isArray(record.approver_ids) && record.approver_ids.length){
          approvalPicker.setSelected(record.approver_ids.map(id => String(id)));
        }
        if (record.approval_id){
          const approvalRecord = buildApprovalRecord(record);
          if (approvalRecord){
            await syncApproval(approvalRecord, { session: currentSession });
          }
        }
      }
    }catch(error){
      console.error("[transport] load existing failed", error);
      showMessage("Не удалось загрузить существующую заявку.", true);
    }
  }else{
    toggleActionButtons("черновик");
  }

  bindDestinationSelect();
  updateDestinationInfo();
}

function bindEvents(){
  if (fileInput){
    fileInput.addEventListener("change", (event)=>{
      selectedFiles = Array.from(event.target.files || []);
      renderFilesList();
    });
  }

  form?.addEventListener("submit", handleSubmit);

  document.addEventListener("click", (event)=>{
    const trigger = event.target.closest("[data-open-approver-modal]");
    if (trigger){
      event.preventDefault();
      if (!existingRequest?.id){
        showMessage("Сохраните заявку, прежде чем назначать согласующих.", true);
        return;
      }
      openApproverModal();
    }
  });

  document.addEventListener("keydown", (event)=>{
    if (event.key === "Escape" && approverModal && !approverModal.hidden){
      event.preventDefault();
      closeApproverModal();
    }
  });

  approverModalClose?.addEventListener("click", closeApproverModal);
  approverModalCancel?.addEventListener("click", closeApproverModal);

  approverModalApply?.addEventListener("click", async ()=>{
    await persistCurrentApproverSelection({ refresh: true }).catch(error=>{
      console.warn("[transport] persist approvers failed", error);
      showMessage("Не удалось сохранить список согласующих.", true);
    });
    closeApproverModal();
  });

  approverModal?.addEventListener("click", event=>{
    if (event.target === approverModal){
      closeApproverModal();
    }
  });
}

async function loadExisting(id){
  const { data, error } = await supabase
    .from("transport_requests")
    .select("id, request_no, user_id, destination, date_from, date_to, vehicle, vehicle_meta, cargo, loading_conditions, priority, requirements, route, safety, finance, billing_type, attachments, status, approval_id, approver_ids, approval")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadObjectDirectory(){
  if (!objectSelect){
    objectDirectory.loading = false;
    return;
  }
  objectDirectory.loading = true;
  objectDirectory.error = null;
  objectSelect.innerHTML = `<option value="" disabled selected>Загружаем…</option>`;
  objectSelect.disabled = true;
  if (objectInfo){
    objectInfo.textContent = "Подготавливаем список объектов…";
  }

  try{
    const rows = await cachedFetch("objects:dir-list", async ()=>{
      const { data, error } = await supabase
        .from("objects")
        .select("id, title, address")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }, { ttlMs: 180000 });

    objectDirectory.list = rows;
    objectDirectory.map = new Map(rows.map(obj => [String(obj.id), obj]));

    objectSelect.innerHTML = "";
    if (!rows.length){
      const opt = document.createElement("option");
      opt.value = "";
      opt.disabled = true;
      opt.textContent = "Объекты пока не созданы";
      objectSelect.appendChild(opt);
      objectSelect.disabled = true;
      if (objectInfo){
        objectInfo.textContent = "Перейдите в раздел «Объекты», чтобы добавить первый объект.";
      }
    }else{
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "Выберите объект";
      objectSelect.appendChild(placeholder);

      const fragment = document.createDocumentFragment();
      rows.forEach(obj=>{
        const opt = document.createElement("option");
        opt.value = String(obj.id);
        const parts = [obj.title, obj.address].filter(Boolean);
        opt.textContent = parts.length ? parts.join(" · ") : `Объект #${obj.id}`;
        fragment.appendChild(opt);
      });
      objectSelect.appendChild(fragment);
      objectSelect.disabled = false;
    }
  }catch(error){
    console.error("[transport] load objects failed", error);
    objectDirectory.error = error;
    objectSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.textContent = "Ошибка загрузки объектов";
    objectSelect.appendChild(opt);
    objectSelect.disabled = true;
    if (objectInfo){
      objectInfo.textContent = error.message || "Не удалось загрузить список объектов.";
    }
  }finally{
    objectDirectory.loading = false;
  }
}

function bindDestinationSelect(){
  if (!objectSelect) return;
  objectSelect.addEventListener("change", updateDestinationInfo);
}

function updateDestinationInfo(){
  if (!objectInfo || !objectSelect){
    return;
  }
  const obj = objectDirectory.map.get(objectSelect.value);
  if (obj){
    objectInfo.textContent = obj.address ? obj.address : "Адрес не указан";
  }else if (existingRequest?.destination){
    objectInfo.textContent = existingRequest.destination;
  }else if (objectDirectory.loading){
    objectInfo.textContent = "Подготавливаем список объектов…";
  }else if (!objectDirectory.list.length){
    objectInfo.textContent = objectDirectory.error
      ? "Не удалось загрузить список объектов."
      : "Объекты ещё не созданы.";
  }else{
    objectInfo.textContent = "Выберите объект";
  }
}

async function handleSubmit(event){
  event.preventDefault();
  const submitter = event.submitter || btnSave;
  const action = submitter?.dataset?.action || "save";
  const isSubmit = action === "submit";

  showMessage("");
  setBusy(true, submitter);

  try{
    const build = await buildPayload({ statusOverride: isSubmit ? "на согласовании" : null });
    if (!build){
      setBusy(false);
      return;
    }

    const {
      payload,
      destinationLabel,
      attachmentsText,
      selectedApprovers,
      selectedApproverNames
    } = build;

    const hadApproval = Boolean(existingRequest?.approval_id);

    if (isSubmit && !hadApproval && !selectedApprovers.length){
      revealApprovalSection();
      approvalFlow.showApproverSection?.();
      openApproverModal();
      showMessage("Добавьте хотя бы одного согласующего перед отправкой.", true);
      setBusy(false);
      return;
    }

    let record;
    if (existingRequest?.id){
      record = await updateRequest(existingRequest.id, payload);
    }else{
      record = await createRequest(payload);
    }

    if (!record){
      throw new Error("Не удалось сохранить заявку.");
    }

    existingRequest = {
      ...(existingRequest || {}),
      ...record,
      destination: destinationLabel,
      status: payload.status || record.status || existingRequest?.status || "черновик"
    };

    currentSession = currentSession || await requireSession({ redirectTo: "./index.html" });

    const uploaded = await persistAttachments(record.id, attachmentsText);

    if (Array.isArray(uploaded?.files)){
      existingRequest.attachments = uploaded.attachments;
    }else if (uploaded){
      existingRequest.attachments = uploaded;
    }

    const selectedNames = selectedApproverNames || [];
    await updateRequestApprovers(record.id, selectedApprovers, selectedNames);

    const url = new URL(location.href);
    if (record.id){
      url.searchParams.set("id", record.id);
      history.replaceState({}, "", url.toString());
    }

    toggleActionButtons(existingRequest.status);

    if (fileInput){
      fileInput.value = "";
    }
    selectedFiles = [];
    renderFilesList();

    const approvalRecord = buildApprovalRecord(existingRequest);

    if (isSubmit){
      if (approvalRecord){
        await syncApproval(approvalRecord, { session: currentSession });
      }
      showMessage("Заявка отправлена на согласование.", false);
    }else{
      if (existingRequest?.approval_id && approvalRecord){
        await syncApproval(approvalRecord, { session: currentSession });
      }
      showMessage("Черновик сохранён.", false);
    }
  }catch(error){
    console.error("[transport] handleSubmit failed", error);
    showMessage(error.message || "Не удалось сохранить заявку. Попробуйте позже.", true);
  }finally{
    setBusy(false);
  }
}

async function createRequest(payload){
  const userId = currentSession?.user?.id;
  if (!userId){
    throw new Error("Не удалось определить пользователя.");
  }
  const insertPayload = {
    ...payload,
    user_id: userId
  };
  if (payload.requirements === null) insertPayload.requirements = null;
  if (payload.route === null) insertPayload.route = null;
  if (payload.safety === null) insertPayload.safety = null;
  if (!payload.attachments){
    insertPayload.attachments = payload.attachments ?? null;
  }
  const { data, error } = await supabase
    .from("transport_requests")
    .insert(insertPayload)
    .select("id, request_no, status, approval_id, approver_ids, approval")
    .single();
  if (error) throw error;
  return data;
}

async function updateRequest(id, payload){
  const patch = { ...payload };
  delete patch.attachments;
  const { data, error } = await supabase
    .from("transport_requests")
    .update(patch)
    .eq("id", id)
    .select("id, request_no, status, approval_id, approver_ids, approval")
    .single();
  if (error) throw error;
  return data;
}

async function persistAttachments(requestId, attachmentsText){
  if (!requestId){
    return existingRequest?.attachments || null;
  }

  let uploadedFiles = [];
  if (selectedFiles.length){
    uploadedFiles = await uploadSelectedFiles(requestId);
  }

  const { data: current, error } = await supabase
    .from("transport_requests")
    .select("attachments")
    .eq("id", requestId)
    .maybeSingle();
  if (error){
    console.warn("[transport] fetch attachments failed", error);
  }

  const prev = current?.attachments || existingRequest?.attachments || {};
  const files = [
    ...(Array.isArray(prev?.files) ? prev.files : []),
    ...uploadedFiles
  ];

  const next = {};
  if (attachmentsText && attachmentsText.trim()){
    next.text = attachmentsText.trim();
  }else if (prev?.text){
    next.text = null;
  }
  if (files.length){
    next.files = files;
  }

  const payload = Object.keys(next).length ? next : null;

  try{
    await supabase
      .from("transport_requests")
      .update({ attachments: payload })
      .eq("id", requestId);
  }catch(updateError){
    console.warn("[transport] update attachments failed", updateError);
  }

  return {
    attachments: payload,
    files: uploadedFiles
  };
}

async function uploadSelectedFiles(requestId){
  if (!selectedFiles.length){
    return [];
  }
  const userId = currentSession?.user?.id;
  if (!userId){
    throw new Error("Не удалось определить пользователя.");
  }
  const uploaded = [];
  for (const file of selectedFiles){
    const safeName = `${Date.now()}-${sanitizeName(file.name)}`;
    const storagePath = `${userId}/${requestId}/${safeName}`;
    const { error } = await supabase
      .storage
      .from("transport_files")
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false
      });
    if (error) throw error;
    const { data: publicData } = supabase
      .storage
      .from("transport_files")
      .getPublicUrl(storagePath);
    uploaded.push({
      bucket: "transport_files",
      path: storagePath,
      public_url: publicData?.publicUrl || null,
      name: file.name,
      size: file.size,
      mime: file.type || null
    });
  }
  return uploaded;
}

async function updateRequestApprovers(requestId, approverIds, approverNames){
  if (!requestId){
    return;
  }
  const uniqueIds = Array.isArray(approverIds) ? Array.from(new Set(approverIds.filter(Boolean).map(String))) : [];
  const names = [];
  const seen = new Set();
  if (Array.isArray(approverIds) && Array.isArray(approverNames)){
    approverIds.forEach((id, idx)=>{
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      names.push(approverNames[idx] || "");
    });
  }
  try{
    await supabase
      .from("transport_requests")
      .update({
        approver_ids: uniqueIds,
        approval: uniqueIds.length ? { approver_ids: uniqueIds, approver_names: names } : null
      })
      .eq("id", requestId);
    if (!existingRequest) existingRequest = {};
    existingRequest.approver_ids = uniqueIds;
    existingRequest.approval = uniqueIds.length ? { approver_ids: uniqueIds, approver_names: names } : null;
    if (uniqueIds.length){
      approvalPicker.setSelected(uniqueIds);
    }else{
      approvalPicker.reset();
    }
  }catch(error){
    console.warn("[transport] update approver ids failed", error);
  }
}

function buildPayload({ statusOverride } = {}){
  const destination = getSelectedObject();
  const hasStoredDestination = Boolean(existingRequest?.destination);
  const errors = [];
  if (!destination && !hasStoredDestination){
    errors.push(objectDirectory.loading ? "Дождитесь загрузки списка объектов." : "Выберите объект из списка.");
  }

  const dateFrom = byId("date_from")?.value || "";
  const dateTo = byId("date_to")?.value || "";
  if (!dateFrom){
    errors.push("Укажите дату начала.");
  }
  if (!dateTo){
    errors.push("Укажите дату окончания.");
  }
  if (dateFrom && dateTo && dateFrom > dateTo){
    errors.push("Дата окончания должна быть не раньше даты начала.");
  }

  const vehicleType = byId("vehicle_type")?.value || "";
  if (!vehicleType){
    errors.push("Выберите тип техники.");
  }

  if (errors.length){
    showMessage(errors.join(" "), true);
    return null;
  }

  const destinationLabel = destination
    ? [destination.title, destination.address].filter(Boolean).join(" · ") || destination.title || "Объект"
    : existingRequest?.destination || "Объект";

  const vehicleDetails = byId("vehicle_details")?.value?.trim() || "";
  const vehicle = [vehicleType, vehicleDetails].filter(Boolean).join(" — ");

  const attachmentsText = readText("attachments");

  const status = statusOverride || existingRequest?.status || "черновик";

  const pickerEntries = approvalPicker?.getSelectedEntries ? approvalPicker.getSelectedEntries() : [];
  const approverIds = [];
  const approverNames = [];
  const seen = new Set();
  pickerEntries.forEach(entry=>{
    const id = entry?.id ?? entry?.value;
    if (!id) return;
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    approverIds.push(key);
    const name = entry.displayName || entry.name || (entry.login ? `@${entry.login}` : "") || entry.meta || "";
    approverNames.push(name);
  });

  const payload = {
    destination: destinationLabel,
    date_from: dateFrom || null,
    date_to: dateTo || null,
    vehicle,
    vehicle_meta: {
      type: vehicleType,
      loading: byId("vehicle_loading")?.value || null,
      details: vehicleDetails || null
    },
    cargo: {
      name: byId("cargo_name")?.value?.trim() || null,
      type: byId("cargo_type")?.value || null,
      hazard_class: byId("cargo_hazard")?.value || null,
      weight_tonnes: parseNumber(byId("cargo_weight")?.value),
      volume_m3: parseNumber(byId("cargo_volume")?.value),
      packaging: byId("cargo_packaging")?.value || null,
      notes: readText("cargo_notes") || null
    },
    loading_conditions: byId("loading_conditions")?.value || null,
    priority: byId("priority")?.value || null,
    requirements: readText("requirements") || null,
    route: readText("route") || null,
    safety: readText("safety") || null,
    finance: byId("finance")?.value ? parseNumber(byId("finance")?.value) : null,
    billing_type: byId("billing_type")?.value || null,
    status,
    approver_ids: approverIds,
    approval: approverIds.length ? { approver_ids: approverIds, approver_names: approverNames } : null
  };

  return {
    payload,
    destinationLabel,
    attachmentsText,
    selectedApprovers: approverIds,
    selectedApproverNames: approverNames
  };
}

function populateForm(record){
  byId("date_from")?.setAttribute("value", record.date_from || "");
  if (byId("date_from")) byId("date_from").value = record.date_from || "";
  if (byId("date_to")) byId("date_to").value = record.date_to || "";

  setSelectValue(byId("vehicle_type"), record?.vehicle_meta?.type || "");
  setSelectValue(byId("vehicle_loading"), record?.vehicle_meta?.loading || "");
  if (byId("vehicle_details")) byId("vehicle_details").value = record?.vehicle_meta?.details || "";

  if (byId("cargo_name")) byId("cargo_name").value = record?.cargo?.name || "";
  setSelectValue(byId("cargo_type"), record?.cargo?.type || "");
  setSelectValue(byId("cargo_hazard"), record?.cargo?.hazard_class || "");
  if (byId("cargo_weight")) byId("cargo_weight").value = record?.cargo?.weight_tonnes ?? "";
  if (byId("cargo_volume")) byId("cargo_volume").value = record?.cargo?.volume_m3 ?? "";
  if (byId("cargo_packaging")) byId("cargo_packaging").value = record?.cargo?.packaging || "";
  setText("cargo_notes", record?.cargo?.notes || "");

  setSelectValue(byId("loading_conditions"), record?.loading_conditions || "");
  setSelectValue(byId("priority"), record?.priority || "");
  setText("requirements", record?.requirements || "");
  setText("route", record?.route || "");
  setText("safety", record?.safety || "");
  if (byId("finance")) byId("finance").value = record?.finance ?? "";
  setSelectValue(byId("billing_type"), record?.billing_type || "");
  setText("attachments", record?.attachments?.text || "");

  if (objectInfo && record.destination){
    objectInfo.textContent = record.destination;
  }
}

function setSelectValue(select, value){
  if (!select) return;
  const target = Array.from(select.options || []).find(opt => opt.value === String(value));
  if (target){
    select.value = target.value;
  }else if (value === "" || value === null || value === undefined){
    select.selectedIndex = 0;
  }
}

function getSelectedObject(){
  if (!objectSelect){
    return null;
  }
  const value = objectSelect.value;
  if (!value){
    return null;
  }
  return objectDirectory.map.get(value) || null;
}

function parseNumber(value){
  if (value === null || value === undefined || value === ""){
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readText(id){
  const el = byId(id);
  if (!el) return "";
  return el.innerText.trim();
}

function setText(id, value){
  const el = byId(id);
  if (!el) return;
  el.innerText = value || "";
}

function showMessage(text, isError = false){
  if (!formMessage) return;
  if (!text){
    formMessage.textContent = "";
    formMessage.className = "";
    formMessage.style.display = "none";
    return;
  }
  formMessage.textContent = text;
  formMessage.className = isError ? "err" : "ok";
  formMessage.style.display = "block";
}

function setBusy(state, actor){
  const buttons = [btnSave, btnSubmitApproval].filter(Boolean);
  buttons.forEach(btn=>{
    if (!btn) return;
    if (state){
      if (!btn.dataset.label){
        btn.dataset.label = btn.textContent;
      }
      btn.disabled = true;
      if (actor && btn === actor){
        btn.textContent = btn.dataset.action === "submit" ? "Отправляем…" : "Сохраняем…";
      }
    }else{
      btn.disabled = false;
      if (btn.dataset.label){
        btn.textContent = btn.dataset.label;
      }
    }
  });
}

function renderFilesList(){
  if (!filesList){
    return;
  }
  if (!selectedFiles.length){
    filesList.textContent = "Файлы не выбраны.";
    return;
  }
  const lines = selectedFiles.map(file => `• ${file.name} — ${Math.ceil(file.size / 1024)} KB`);
  filesList.textContent = lines.join("\n");
}

function sanitizeName(name){
  return name.replace(/[^\w.\-]+/g, "_");
}

function buildApprovalRecord(record){
  if (!record) return null;
  return {
    id: record.id,
    approval_id: record.approval_id,
    title: record.destination || "Заявка на автотранспорт",
    number: record.request_no || null,
    object_id: null,
    status: record.status
  };
}

async function syncApproval(record, options = {}){
  await approvalFlow.sync(record, options);
  revealApprovalSection();
  showApprovalCard();
  removeApprovalHint();
}

function revealApprovalSection(){
  if (approvalSection){
    approvalSection.hidden = false;
  }
  approvalFlow.revealMountSection?.();
}

function showApprovalCard(){
  if (approvalBlockCard){
    approvalBlockCard.hidden = false;
  }
}

function removeApprovalHint(){
  if (approvalBlockHint){
    approvalBlockHint.remove();
  }
}

function openApproverModal(){
  if (!approverModal || !approverPickerField) return;
  approverPickerField.hidden = false;
  approverModal.hidden = false;
  approverModal.scrollTop = 0;
  const panel = approverModal.querySelector(".approver-modal__panel");
  if (panel){
    panel.scrollTop = 0;
  }
  document.body?.classList.add("has-modal");
  approvalPicker.toggleDropdown(true);
  requestAnimationFrame(()=>{
    document.getElementById("approversSearch")?.focus();
  });
}

function closeApproverModal(){
  if (!approverModal || !approverPickerField) return;
  approvalPicker.toggleDropdown(false);
  approvalPicker?.clearQuery?.();
  approverModal.hidden = true;
  approverPickerField.hidden = true;
  document.body?.classList.remove("has-modal");
}

async function persistCurrentApproverSelection({ refresh = false } = {}){
  if (!existingRequest?.id){
    showMessage("Сначала сохраните заявку.", true);
    return;
  }
  if (!existingRequest.approval_id){
    const record = buildApprovalRecord(existingRequest);
    if (record){
      await syncApproval(record, { session: currentSession, isNew: true });
    }
  }
  if (!existingRequest.approval_id){
    showMessage("Не удалось подготовить согласование. Обновите страницу и попробуйте снова.", true);
    return;
  }
  const entries = approvalPicker?.getSelectedEntries ? approvalPicker.getSelectedEntries() : [];
  try{
    const savedIds = await updateApprovalAssignment(existingRequest.approval_id, entries);
    const names = [];
    const seen = new Set();
    entries.forEach(entry=>{
      const id = entry?.id ?? entry?.value;
      if (!id) return;
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      names.push(entry.displayName || entry.name || (entry.login ? `@${entry.login}` : "") || entry.meta || "");
    });
    await updateRequestApprovers(existingRequest.id, savedIds, names);
    if (refresh){
      const record = buildApprovalRecord(existingRequest);
      if (record){
        await approvalFlow.sync(record, { session: currentSession });
      }
    }
  }catch(error){
    console.error("[transport] persist approvers failed", error);
    throw error;
  }
}

async function updateApprovalAssignment(assignmentId, entries = []){
  if (!assignmentId) return [];
  const list = Array.isArray(entries) ? entries : [];
  const nameMap = new Map();
  const orderedIds = [];
  list.forEach(entry=>{
    const id = entry?.id ?? entry?.value;
    if (!id) return;
    const strId = String(id);
    if (!nameMap.has(strId)){
      nameMap.set(strId, entry.displayName || entry.name || entry.login || entry.meta || "");
      orderedIds.push(strId);
    }
  });
  const approverIdsInput = Array.from(new Set(orderedIds));
  const approverNames = approverIdsInput.map(id => nameMap.get(id) || "");
  const { data: updatedRow, error } = await supabase
    .from("document_approval_assignments")
    .update({
      approver_ids: approverIdsInput,
      approver_names: approverNames,
      status: approverIdsInput.length ? "in_review" : "draft"
    })
    .eq("id", assignmentId)
    .select("approver_ids")
    .single();
  if (error) throw error;
  const resultIds = Array.isArray(updatedRow?.approver_ids)
    ? updatedRow.approver_ids.map(id => String(id))
    : approverIdsInput;
  return resultIds;
}

function toggleActionButtons(status){
  const normalized = String(status || "").toLowerCase();
  const isDraft = !normalized || normalized === "draft" || normalized.includes("чернов");
  if (buttonRow){
    buttonRow.classList.toggle("hidden", false);
  }
  if (btnSubmitApproval){
    btnSubmitApproval.disabled = !isDraft;
  }
}
