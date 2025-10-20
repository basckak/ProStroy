import supabase, { requireSession } from "../supabaseClient.js";
import { invalidateCache } from "../cache.js";
import { createApprovalPicker } from "../approvalPicker.js";
import { createApprovalFlow } from "../approvalFlow.js";
import {
  fetchDocById,
  createDoc,
  updateDoc,
  uploadFile,
  publicUrl,
  fetchObjects,
  fetchCounterparties,
  normalizeAmount,
  fillSelect
} from "./documents-api.js";

const CATEGORY = "contracts";
const SUBTYPE = "subcontract";
const DEFAULT_PAYMENT_TERMS = [
  "Оплата производится по факту выполненных работ по актам КС-2/КС-3.",
  "Аванс перечисляется в течение 5 рабочих дней после подписания договора.",
  "Оставшаяся сумма выплачивается в течение 10 рабочих дней после подписания актов."
].join("\n");

const STATUS_META = {
  draft: { label: "Черновик", pill: "status-draft" },
  in_review: { label: "На согласовании", pill: "status-on_review" },
  approved: { label: "Согласовано", pill: "status-approved" },
  finalized: { label: "Оформлен", pill: "status-completed" },
  final: { label: "Оформлен", pill: "status-completed" },
  rejected: { label: "Отклонён", pill: "status-rejected" }
};

const headerReady = window.headerReady || Promise.resolve();

const form = document.getElementById("docForm");
const statusPill = document.getElementById("docStatusPill");
const modeLabel = document.getElementById("formModeLabel");
const messageEl = document.getElementById("formMessage");
const btnSave = document.getElementById("btnSave");
const btnSubmitApproval = document.getElementById("btnSubmitApproval");
const fileInput = document.getElementById("file");
const currentFileLink = document.getElementById("currentFileLink");
const vatIncluded = document.getElementById("vat_included");
const vatRate = document.getElementById("vat_rate");
const btnDefaultTerms = document.getElementById("btnDefaultTerms");

const amountInput = document.getElementById("amount");
const paymentTerms = document.getElementById("payment_terms");
const refsError = document.getElementById("refsError");
const fldObject = document.getElementById("fldObject");
const fldCp1 = document.getElementById("fldCp1");
const fldCp2 = document.getElementById("fldCp2");
const buttonRow = document.querySelector(".button-row");
const approvalSection = document.getElementById("approvalSection");
const approvalBlockCard = document.getElementById("approvalBlockCard");
const approvalBlockHint = document.getElementById("approvalBlockHint");
const approverPickerField = document.getElementById("approverPickerField");
const approverModal = document.getElementById("approverModal");
const approverModalClose = document.getElementById("approverModalClose");
const approverModalCancel = document.getElementById("approverModalCancel");
const approverModalApply = document.getElementById("approverModalApply");

let currentDocId = null;
let existingDoc = null;
let currentSession = null;

const approvalPicker = createApprovalPicker({
  supabase,
  wrapper: "approversSelect",
  display: "approversDisplay",
  search: "approversSearch",
  options: "approversOptions",
  help: "approversHelp"
});

const approvalFlow = createApprovalFlow({
  docKind: "subcontract",
  tableName: "request_documents",
  supabase,
  requireSession,
  approvalPicker,
  mountSection: "approvalSection",
  approverSection: "approverPickerField",
  buildTitle: (record)=>{
    const parts = [];
    if (record.title){
      parts.push(record.title);
    } else {
      parts.push("Договор подряда");
    }
    if (record.number){
      parts.push(`№ ${record.number}`);
    }
    if (record.counterparty_name){
      parts.push(record.counterparty_name);
    }
    return parts.join(" · ");
  },
  resolveObjectId: (record)=> record.object_id || null,
  onApprovalEstablished: (newApprovalId)=>{
    if (!existingDoc) existingDoc = {};
    existingDoc.approval_id = newApprovalId;
    removeApprovalHint();
    closeApproverModal();
  },
  onApprovalRemoved: ()=>{
    if (!existingDoc) existingDoc = {};
    existingDoc.approval_id = null;
    existingDoc.status = "draft";
    approvalPicker?.setSelected?.([]);
    approvalPicker?.reset?.();
    showApprovalCard();
    showMessage("Согласование удалено. Назначьте новых согласующих.", false);
  }
});

approvalFlow.hideApproverSection();

init().catch(err => {
  console.error("[contracts-subcontract] init failed", err);
  showMessage("Не удалось инициализировать форму. Обновите страницу.", true);
});

async function init(){
  await headerReady;
  currentSession = await requireSession({ redirectTo: "/index.html" });

  bindEvents();

  const params = new URLSearchParams(location.search);
  currentDocId = params.get("id");

  let prefill = null;
  if (currentDocId){
    prefill = await loadExisting(currentDocId);
  } else {
    updateStatus("draft");
    setMode("create");
  }

  await Promise.all([
    loadReferences(prefill),
    approvalPicker.loadDirectory().catch(error => {
      console.error("[contracts-subcontract] approver load error", error);
    })
  ]);

  if (!prefill){
    showApprovalCard();
  }

  if (prefill){
    await syncApproval(prefill, { session: currentSession });
  }

  if (window.sb?.auth){
    window.sb.auth.onAuthStateChange((_event, session)=>{
      if (!session){
        location.replace("/index.html");
        return;
      }
      currentSession = session;
      approvalPicker.loadDirectory().catch(error => {
        console.error("[contracts-subcontract] approver reload error", error);
      });
    });
  }
}

function bindEvents(){
  form?.addEventListener("submit", handleSubmit);
  vatIncluded?.addEventListener("change", syncVatVisibility);
  btnDefaultTerms?.addEventListener("click", event => {
    event.preventDefault();
    if (!paymentTerms) return;
    if (!paymentTerms.value.trim()){
      paymentTerms.value = DEFAULT_PAYMENT_TERMS;
    } else {
      paymentTerms.value = `${paymentTerms.value.trim()}\n${DEFAULT_PAYMENT_TERMS}`;
    }
  });
  if (amountInput){
    amountInput.addEventListener("blur", ()=>{
      const value = normalizeAmount(amountInput.value);
      if (value !== null && !Number.isNaN(value)){
        amountInput.value = formatAmount(value);
      }
    });
  }
  syncVatVisibility();
  if (btnSave){
    btnSave.dataset.label = btnSave.textContent;
  }
  if (btnSubmitApproval){
    btnSubmitApproval.dataset.label = btnSubmitApproval.textContent;
  }
  if (approverModalClose){
    approverModalClose.addEventListener("click", ()=>{
      closeApproverModal();
    });
  }
  if (approverModalCancel){
    approverModalCancel.addEventListener("click", ()=>{
      closeApproverModal();
    });
  }
  if (approverModalApply){
    approverModalApply.addEventListener("click", async ()=>{
      closeApproverModal();
      await persistCurrentApproverSelection({ refresh: true }).catch(error => {
        console.warn("[contracts-subcontract] persist approvers failed", error);
      });
    });
  }
  if (approverModal){
    approverModal.addEventListener("click", (event)=>{
      if (event.target === approverModal){
        closeApproverModal();
      }
    });
  }
  document.addEventListener("click", (event)=>{
    const trigger = event.target.closest("[data-open-approver-modal]");
    if (trigger){
      event.preventDefault();
      openApproverModal();
    }
  });
  document.addEventListener("keydown", (event)=>{
    if (event.key === "Escape" && approverModal && !approverModal.hidden){
      event.preventDefault();
      closeApproverModal();
    }
  });
}

async function loadReferences(prefill){
  if (refsError){
    refsError.hidden = true;
    refsError.textContent = "";
  }

  try{
    const [objects, counterparties] = await Promise.all([
      fetchObjects(),
      fetchCounterparties()
    ]);

    fillSelect(fldObject, objects, "— выбрать объект —");
    fillSelect(fldCp1, counterparties, "— выбрать контрагента —");
    fillSelect(fldCp2, counterparties, "— при необходимости —");

    if (prefill){
      applyPrefill(fldObject, prefill.object_id, prefill.object_name);
      applyPrefill(fldCp1, prefill.counterparty_id, prefill.counterparty_name);
      applyPrefill(fldCp2, prefill.counterparty2_id, prefill.counterparty2_name);
      if (!prefill.counterparty_name){
        const selected = fldCp1?.selectedOptions?.[0];
        prefill.counterparty_name = selected?.textContent?.trim() || prefill.counterparty_name || null;
      }
    }

    if ((fldObject?.options.length ?? 0) <= 1 || (fldCp1?.options.length ?? 0) <= 1){
      if (refsError){
        refsError.textContent = "Справочники пусты. Добавьте объекты и контрагентов.";
        refsError.hidden = false;
      }
    }
  }catch(error){
    console.error("[contracts-subcontract] reference load error", error);
    if (refsError){
      refsError.textContent = "Не удалось загрузить справочники объектов и контрагентов.";
      refsError.hidden = false;
    }
  }
}

function applyPrefill(select, value, fallbackLabel){
  if (!select) return;
  if (value === undefined || value === null || value === "") return;
  const strValue = String(value);
  const exists = Array.from(select.options).some(option => option.value === strValue);
  if (!exists){
    const opt = document.createElement("option");
    opt.value = strValue;
    opt.textContent = (fallbackLabel ?? "").trim() || `(ID ${strValue})`;
    select.appendChild(opt);
  }
  select.value = strValue;
}

async function loadExisting(id){
  try{
    const doc = await fetchDocById(id);
    if (!doc || doc.category !== CATEGORY || doc.subtype !== SUBTYPE){
      showMessage("Документ не найден или имеет другой тип.", true);
      return null;
    }
    existingDoc = doc;
    setMode("edit");
    updateStatus(doc.status || "draft");
    fillBaseFields(doc);
    fillDetails(doc.details);
    if (doc.file_path){
      const url = publicUrl(doc.file_path);
      if (url && currentFileLink){
        const name = doc.file_name || "Скачать файл";
        currentFileLink.innerHTML = `Текущий файл: <a href="${url}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
      }
    }
    return doc;
  }catch(error){
    console.error("[contracts-subcontract] loadExisting error", error);
    showMessage("Не удалось загрузить документ для редактирования.", true);
    return null;
  }
}

function setMode(mode){
  if (!modeLabel) return;
  modeLabel.textContent = mode === "edit" ? "Редактирование" : "Создание";
}

function updateStatus(status){
  if (!statusPill) return;
  const info = STATUS_META[status] || STATUS_META.draft;
  statusPill.textContent = info.label;
  statusPill.className = `status-badge ${info.pill}`;
  toggleActionButtons(status);
}

function fillBaseFields(doc){
  setValue("title", doc.title);
  setValue("number", doc.number);
  setValue("fldObject", doc.object_id);
  setValue("fldCp1", doc.counterparty_id);
  setValue("fldCp2", doc.counterparty2_id);
  setValue("amount", formatAmount(doc.amount));
  setValue("notes", doc.notes);
}

function fillDetails(details){
  if (!details) return;
  const data = typeof details === "string" ? safeParse(details) : details;
  if (!data) return;
  setValue("work_scope", data.work_scope);
  setValue("work_address", data.work_address);
  setValue("base_spec_ref", data.base_spec_ref);
  setValue("start_date", formatDate(data.start_date));
  setValue("end_date", formatDate(data.end_date));
  if (data.vat_included){
    vatIncluded.checked = true;
    setValue("vat_rate", data.vat_rate ?? "20");
  } else {
    vatIncluded.checked = false;
  }
  syncVatVisibility();
  setValue("prepayment_percent", formatNumber(data.prepayment_percent));
  setValue("retention_percent", formatNumber(data.retention_percent));
  setValue("payment_delay_days", toNumberString(data.payment_delay_days));
  setValue("payment_terms", data.payment_terms);
  setValue("warranty_months", toNumberString(data.warranty_months));
  setValue("customer_contract_number", data.customer_contract_number);
  setValue("estimate_ref", data.estimate_ref);
  setValue("resp_internal", data.resp_internal);
  setValue("resp_external", data.resp_external);
}

async function handleSubmit(event){
  event.preventDefault();
  const submitter = event.submitter || btnSave;
  const action = submitter?.dataset?.action || "save";
  const isSubmit = action === "submit";
  showMessage("");
  setBusy(true, submitter);
  try{
    const result = await buildPayload({ statusOverride: isSubmit ? "in_review" : null });
    if (!result){
      setBusy(false);
      return;
    }
    const { payload, details } = result;
    const selectedEntries = approvalPicker?.getSelectedEntries ? approvalPicker.getSelectedEntries() : [];
    const selectedApprovers = selectedEntries.map(entry => entry.id);
    const hadApproval = Boolean(existingDoc?.approval_id);

    if (isSubmit && !hadApproval && !selectedApprovers.length){
      revealApprovalSection();
      approvalFlow.showApproverSection();
      openApproverModal();
      approverPickerField?.scrollIntoView({ behavior: "smooth", block: "center" });
      showMessage("Добавьте хотя бы одного согласующего перед отправкой.", true);
      setBusy(false);
      return;
    }

    let docRecord;

    if (existingDoc){
      docRecord = await updateDoc(existingDoc.id, payload);
    } else {
      docRecord = await createDoc(payload);
      currentDocId = docRecord.id;
    }

    let docId = docRecord?.id ?? currentDocId ?? null;

    const approvalId = docRecord?.approval_id ?? existingDoc?.approval_id ?? null;
    const counterpartyName = resolveCounterpartyName(payload.counterparty_id);

    existingDoc = {
      ...(existingDoc || {}),
      ...docRecord,
      approval_id: approvalId,
      counterparty_name: counterpartyName,
      details
    };
    currentDocId = existingDoc.id || docId;

    if (existingDoc.file_path && currentFileLink){
      const url = publicUrl(existingDoc.file_path);
      if (url){
        const name = existingDoc.file_name || "Скачать файл";
        currentFileLink.innerHTML = `Текущий файл: <a href="${url}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
      }
    }

    if (fileInput){
      fileInput.value = "";
    }

    const recordForApproval = buildApprovalRecord(existingDoc);

    const url = new URL(location.href);
    if (existingDoc?.id){
      url.searchParams.set("id", existingDoc.id);
      history.replaceState({}, "", url.toString());
    }

    currentDocId = docId;
    setMode("edit");
    updateStatus(payload.status || existingDoc.status || "draft");

    if (isSubmit){
      revealApprovalSection();
      await syncApproval(recordForApproval, { isNew: !approvalId, session: currentSession });
      showApprovalCard();
      showMessage("Договор отправлен на согласование.", false);
      closeApproverModal();
    } else {
      if (approvalId){
        await syncApproval(recordForApproval, { session: currentSession });
        showApprovalCard();
      } else {
        approvalFlow.showApproverSection();
      }
      showMessage("Черновик сохранён.", false);
    }
  }catch(error){
    console.error("[contracts-subcontract] save error", error);
    showMessage("Не удалось сохранить договор. Проверьте заполненные поля.", true);
  }finally{
    setBusy(false);
  }
}

async function buildPayload({ statusOverride } = {}){
  const title = valueOf("title");
  const objectId = valueOf("fldObject");
  const counterpartyId = valueOf("fldCp1");
  const amountValue = normalizeAmount(valueOf("amount"));
  const workScope = valueOf("work_scope");
  const startDate = valueOf("start_date");
  const endDate = valueOf("end_date");

  const errors = [];
  if (!title) errors.push("Заполните «Название документа».");
  if (!objectId) errors.push("Выберите объект.");
  if (!counterpartyId) errors.push("Укажите контрагента.");
  if (amountValue === null || Number.isNaN(amountValue) || amountValue <= 0){
    errors.push("Введите сумму договора больше нуля.");
  }
  if (startDate && endDate && startDate > endDate){
    errors.push("Дата окончания должна быть не раньше даты начала.");
  }
  const needsFile = !existingDoc;
  if (needsFile && !fileInput?.files?.length){
    errors.push("Приложите файл договора.");
  }

  if (errors.length){
    showMessage(errors.join(" "), true);
    return null;
  }

  const details = {
    work_scope: workScope || null,
    work_address: valueOf("work_address") || null,
    base_spec_ref: valueOf("base_spec_ref") || null,
    start_date: startDate || null,
    end_date: endDate || null,
    vat_included: !!vatIncluded?.checked,
    vat_rate: vatIncluded?.checked ? valueOf("vat_rate") || "20" : null,
    prepayment_percent: toNullableNumber(valueOf("prepayment_percent")),
    retention_percent: toNullableNumber(valueOf("retention_percent")),
    payment_delay_days: toNullableInteger(valueOf("payment_delay_days")),
    payment_terms: valueOf("payment_terms") || null,
    warranty_months: toNullableInteger(valueOf("warranty_months")),
    customer_contract_number: valueOf("customer_contract_number") || null,
    estimate_ref: valueOf("estimate_ref") || null,
    resp_internal: valueOf("resp_internal") || null,
    resp_external: valueOf("resp_external") || null
  };

  const payload = {
    category: CATEGORY,
    subtype: SUBTYPE,
    title,
    number: valueOf("number") || null,
    doc_date: null,
    object_id: objectId,
    counterparty_id: counterpartyId,
    counterparty2_id: valueOf("fldCp2") || null,
    amount: amountValue,
    notes: valueOf("notes") || null,
    status: statusOverride ?? (existingDoc?.status || "draft"),
    details
  };

  const file = fileInput?.files?.[0];
  if (file){
    const uploaded = await uploadFile(file, CATEGORY, SUBTYPE);
    payload.file_path = uploaded.path;
    payload.file_name = uploaded.name || file.name;
    payload.file_size = uploaded.size ?? file.size;
    payload.file_type = uploaded.type || file.type;
  } else if (existingDoc){
    payload.file_path = existingDoc.file_path || null;
    payload.file_name = existingDoc.file_name || null;
    payload.file_size = existingDoc.file_size || null;
    payload.file_type = existingDoc.file_type || null;
  }

  return { payload, details };
}

function syncVatVisibility(){
  if (!vatRate) return;
  if (vatIncluded?.checked){
    vatRate.classList.remove("hidden");
  } else {
    vatRate.classList.add("hidden");
  }
}

function setValue(id, value){
  const el = document.getElementById(id);
  if (!el) return;
  if (value === undefined || value === null){
    el.value = "";
  } else {
    el.value = value;
  }
}

function valueOf(id){
  const el = document.getElementById(id);
  if (!el) return "";
  if (el.type === "checkbox") return el.checked ? el.value : "";
  return (el.value || "").trim();
}

function formatDate(value){
  if (!value) return "";
  if (typeof value === "string" && value.includes("T")){
    return value.split("T")[0];
  }
  return value;
}

function formatAmount(value){
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (Number.isNaN(num)) return "";
  return num.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value){
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (Number.isNaN(num)) return "";
  return String(num).replace(".", ",");
}

function toNumberString(value){
  if (value === null || value === undefined) return "";
  return String(value);
}

function toNullableNumber(value){
  if (!value) return null;
  const num = normalizeAmount(value);
  return Number.isNaN(num) ? null : num;
}

function toNullableInteger(value){
  if (!value) return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? Math.round(num) : null;
}

function safeParse(str){
  try{
    return JSON.parse(str);
  }catch(_){
    return null;
  }
}

function showMessage(text, isError = false){
  if (!messageEl) return;
  if (!text){
    messageEl.textContent = "";
    messageEl.className = "";
    messageEl.style.display = "none";
    return;
  }
  messageEl.textContent = text;
  messageEl.className = isError ? "err" : "ok";
  messageEl.style.display = "block";
}

async function updateApprovalAssignment(assignmentId, entries = []){
  if (!assignmentId) return [];
  const list = Array.isArray(entries) ? entries : [];
  const nameMap = new Map();
  const orderedIds = [];
  list.forEach(entry => {
    const id = entry?.id;
    if (!id) return;
    const strId = String(id);
    if (!nameMap.has(strId)){
      nameMap.set(strId, entry.displayName || entry.name || entry.login || entry.meta || "");
      orderedIds.push(strId);
    }
  });
  const approverIdsInput = Array.from(new Set(orderedIds));
  const approverNames = approverIdsInput.map(id => nameMap.get(id) || "");
  try{
    const { data: updatedRow, error: updateError } = await supabase
      .from("document_approval_assignments")
      .update({
        approver_ids: approverIdsInput,
        approver_names: approverNames,
        status: approverIdsInput.length ? "in_review" : "draft"
      })
      .eq("id", assignmentId)
      .select("approver_ids")
      .single();
    if (updateError) throw updateError;
    const resultIds = Array.isArray(updatedRow?.approver_ids)
      ? updatedRow.approver_ids.map(id => String(id))
      : approverIdsInput;
    return resultIds;
  }catch(error){
    console.error("[contracts-subcontract] updateApprovalAssignment error", error);
    throw error;
  }
}

function setBusy(state, actor){
  const buttons = [btnSave, btnSubmitApproval].filter(Boolean);
  buttons.forEach(btn => {
    if (!btn) return;
    if (state){
      if (!btn.dataset.label){
        btn.dataset.label = btn.textContent;
      }
      btn.disabled = true;
      if (actor && btn === actor){
        btn.textContent = btn.dataset.action === "submit" ? "Отправляем…" : "Сохраняем…";
      }
    } else {
      btn.disabled = false;
      if (btn.dataset.label){
        btn.textContent = btn.dataset.label;
      }
    }
  });
}

function resolveCounterpartyName(counterpartyId){
  if (!counterpartyId){
    return existingDoc?.counterparty_name || null;
  }
  const selector = `option[value="${counterpartyId}"]`;
  const option = fldCp1?.querySelector(selector);
  if (option){
    const label = option.textContent?.trim();
    if (label) return label;
  }
  return existingDoc?.counterparty_name || null;
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

function buildApprovalRecord(doc){
  if (!doc) return null;
  return {
    id: doc.id,
    approval_id: doc.approval_id,
    title: doc.title,
    number: doc.number,
    object_id: doc.object_id,
    counterparty_name: doc.counterparty_name,
    status: doc.status
  };
}

function openApproverModal({ focusDisplay = true } = {}){
  if (!approverModal || !approverPickerField) return;
  approverPickerField.hidden = false;
  approverModal.hidden = false;
  approverModal.scrollTop = 0;
  const panel = approverModal.querySelector(".approver-modal__panel");
  if (panel){
    panel.scrollTop = 0;
  }
  approverModal.style.setProperty("--modal-offset", "0px");
  document.body?.classList.add("has-modal");
  approvalPicker.toggleDropdown(true);
  const alignModal = ()=>{
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const panelHeight = panelRect.height;
    const minGap = 32;
    let desiredTop = (window.innerHeight - panelHeight) / 2;
    const maxTop = window.innerHeight - panelHeight - minGap;
    desiredTop = Math.max(minGap, Math.min(desiredTop, Math.max(maxTop, minGap)));
    approverModal.style.setProperty("--modal-offset", `${Math.round(desiredTop)}px`);
  };
  requestAnimationFrame(()=>{
    alignModal();
    requestAnimationFrame(alignModal);
  });
  if (focusDisplay){
    requestAnimationFrame(()=>{
      document.getElementById("approversSearch")?.focus();
    });
  }
}

function closeApproverModal(){
  if (!approverModal || !approverPickerField) return;
  approvalPicker.toggleDropdown(false);
  approvalPicker?.clearQuery?.();
  approverModal.hidden = true;
  approverPickerField.hidden = true;
  document.body?.classList.remove("has-modal");
  approverModal.style.removeProperty("--modal-offset");
}

async function persistCurrentApproverSelection({ refresh = false } = {}){
  if (!existingDoc?.approval_id){
    const record = buildApprovalRecord(existingDoc);
    if (record){
      await syncApproval(record, { session: currentSession, isNew: true });
    }
  }
  if (!existingDoc?.approval_id){
    showMessage("Не удалось подготовить согласование для документа. Обновите страницу и попробуйте снова.", true);
    return;
  }
  const entries = approvalPicker?.getSelectedEntries ? approvalPicker.getSelectedEntries() : [];
  try{
    const savedIds = await updateApprovalAssignment(existingDoc.approval_id, entries);
    if (approvalPicker?.setSelected){
      approvalPicker.setSelected(savedIds);
    }
    approvalPicker?.clearQuery?.();
    if (refresh){
      const record = buildApprovalRecord(existingDoc);
      if (record){
        await approvalFlow.sync(record, { session: currentSession });
      }
    }
    document.dispatchEvent(new CustomEvent("approval-assignment-updated", {
      detail: {
        assignmentId: existingDoc.approval_id,
        documentId: existingDoc.id || null,
        approverIds: savedIds
      }
    }));
  }catch(error){
    console.error("[contracts-subcontract] persistCurrentApproverSelection", error);
    throw error;
  }
}

function toggleActionButtons(status){
  const normalized = String(status || "").toLowerCase();
  const isDraft = !normalized || normalized === "draft" || normalized === "черновик";
  if (buttonRow){
    buttonRow.classList.toggle("hidden", !isDraft);
  }
  if (btnSubmitApproval){
    btnSubmitApproval.disabled = !isDraft;
  }
  if (btnSave){
    btnSave.disabled = !isDraft;
  }
}

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}
