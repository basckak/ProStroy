import supabase, { requireSession } from "../supabaseClient.js";
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
  fillSelect,
  normalizeAmount,
  fetchCounterpartyDetails
} from "./documents-api.js";

const CATEGORY = "contracts";
const SUBTYPE = "service_gph";

const headerReady = window.headerReady || Promise.resolve();

const form = document.getElementById("docForm");
const statusPill = document.getElementById("docStatusPill");
const modeLabel = document.getElementById("formModeLabel");
const messageEl = document.getElementById("formMessage");
const btnSave = document.getElementById("btnSave");
const btnSubmitApproval = document.getElementById("btnSubmitApproval");
const fileInput = document.getElementById("file");
const currentFileLink = document.getElementById("currentFileLink");
const refsError = document.getElementById("refsError");
const fldObject = document.getElementById("fldObject");
const fldPayer = document.getElementById("fldPayer");
const fldExecutor = document.getElementById("fldExecutor");
const ndflRateSelect = document.getElementById("ndfl_rate");
const insuranceSelect = document.getElementById("insurance_required");
const paymentDetailsField = document.getElementById("payment_details");
const onlyAfterActCheckbox = document.getElementById("only_after_act");

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

const counterpartyCache = new Map();

const STATUS_META = {
  draft: { label: "Черновик", pill: "status-draft" },
  in_review: { label: "На согласовании", pill: "status-on_review" },
  approved: { label: "Согласовано", pill: "status-approved" },
  finalized: { label: "Оформлен", pill: "status-completed" },
  rejected: { label: "Отклонён", pill: "status-rejected" }
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
  docKind: "service_gph",
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
      parts.push("Договор ГПХ");
    }
    if (record.number){
      parts.push(`№ ${record.number}`);
    }
    const executorLabel = getExecutorNameFromRecord(record);
    if (executorLabel){
      parts.push(executorLabel);
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
  console.error("[contracts-service-gph] init failed", err);
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
      console.error("[contracts-service-gph] approver load error", error);
    })
  ]);

  if (!prefill){
    showApprovalCard();
  }

  if (prefill){
    await syncApproval(buildApprovalRecord(prefill), { session: currentSession });
    if (prefill.counterparty2_id){
      await hydrateExecutorDefaults(prefill.counterparty2_id);
    }
  }

  if (window.sb?.auth){
    window.sb.auth.onAuthStateChange((_event, session)=>{
      if (!session){
        location.replace("/index.html");
        return;
      }
      currentSession = session;
      approvalPicker.loadDirectory().catch(error => {
        console.error("[contracts-service-gph] approver reload error", error);
      });
    });
  }
}

function bindEvents(){
  form?.addEventListener("submit", handleSubmit);

  ndflRateSelect?.addEventListener("change", ()=>{
    ndflRateSelect.dataset.manual = "true";
  });

  insuranceSelect?.addEventListener("change", ()=>{
    insuranceSelect.dataset.manual = "true";
  });

  paymentDetailsField?.addEventListener("input", ()=>{
    if (paymentDetailsField.value.trim()){
      paymentDetailsField.dataset.autofill = "false";
    } else {
      delete paymentDetailsField.dataset.autofill;
    }
  });

  fldExecutor?.addEventListener("change", async ()=>{
    const executorId = valueOf("fldExecutor");
    if (executorId){
      await hydrateExecutorDefaults(executorId);
    }
  });

  document.addEventListener("click", event => {
    const trigger = event.target.closest("[data-open-approver-modal]");
    if (trigger){
      event.preventDefault();
      openApproverModal();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && approverModal && !approverModal.hidden){
      event.preventDefault();
      closeApproverModal();
    }
  });

  approverModalClose?.addEventListener("click", closeApproverModal);
  approverModalCancel?.addEventListener("click", closeApproverModal);

  approverModalApply?.addEventListener("click", async ()=>{
    closeApproverModal();
    await persistCurrentApproverSelection({ refresh: true }).catch(error => {
      console.warn("[contracts-service-gph] persist approvers failed", error);
    });
  });

  if (approverModal){
    approverModal.addEventListener("click", event => {
      if (event.target === approverModal){
        closeApproverModal();
      }
    });
  }
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
    fillSelect(fldPayer, counterparties, "— выбрать плательщика —");
    fillSelect(fldExecutor, counterparties, "— выбрать исполнителя —");

    if (prefill){
      const details = parseDetails(prefill.details);
      applyPrefill(fldObject, prefill.object_id ?? details?.object_id, prefill.object_name ?? details?.object_name);
      const payerId = prefill.counterparty_id ?? prefill.payer_id ?? details?.payer_id;
      const payerName = prefill.payer_name ?? details?.payer_name;
      applyPrefill(fldPayer, payerId, payerName);
      const executorId = prefill.counterparty2_id ?? prefill.executor_id ?? details?.executor_id;
      const executorName = prefill.executor_name ?? prefill.counterparty_name ?? details?.executor_name;
      applyPrefill(fldExecutor, executorId, executorName);
      if (!prefill.counterparty_name && executorName){
        prefill.counterparty_name = executorName;
      }
    }

    const objectOptions = fldObject?.options?.length ?? 0;
    const payerOptions = fldPayer?.options?.length ?? 0;
    const executorOptions = fldExecutor?.options?.length ?? 0;

    if ((objectOptions <= 1 || payerOptions <= 1 || executorOptions <= 1) && refsError){
      refsError.hidden = false;
      refsError.textContent = "Справочники пусты. Добавьте объекты и контрагентов.";
    }
  }catch(error){
    console.error("[contracts-service-gph] reference load error", error);
    if (refsError){
      refsError.hidden = false;
      refsError.textContent = "Не удалось загрузить справочники объектов и контрагентов.";
    }
  }
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
    populateForm(doc);
    existingDoc.details = parseDetails(doc.details) || {};
    if (doc.file_path){
      const url = publicUrl(doc.file_path);
      if (url && currentFileLink){
        const name = doc.file_name || "Скачать файл";
        currentFileLink.innerHTML = `Текущий файл: <a href="${url}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
      }
    }
    return doc;
  }catch(error){
    console.error("[contracts-service-gph] loadExisting error", error);
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

function populateForm(doc){
  if (!doc) return;
  const details = parseDetails(doc.details);

  setValue("title", doc.title);
  setValue("number", doc.number);
  setValue("doc_date", formatDate(doc.doc_date || details?.doc_date));
  setValue("fldObject", doc.object_id ?? details?.object_id ?? "");

  const payerId = doc.counterparty_id ?? doc.payer_id ?? details?.payer_id ?? "";
  const executorId = doc.counterparty2_id ?? doc.executor_id ?? details?.executor_id ?? "";
  setValue("fldPayer", payerId);
  setValue("fldExecutor", executorId);

  const amountVal = doc.amount ?? details?.amount ?? null;
  setValue("amount", formatAmount(amountVal));
  setValue("notes", doc.notes ?? details?.notes ?? "");

  setValue("service_scope", doc.service_scope ?? details?.service_scope ?? "");
  setValue("period_start", formatDate(doc.period_start ?? details?.period_start));
  setValue("period_end", formatDate(doc.period_end ?? details?.period_end));
  setValue("work_volume", doc.work_volume ?? details?.work_volume ?? "");
  setValue("curator", doc.curator ?? details?.curator ?? "");
  setValue("payment_terms", doc.payment_terms ?? details?.payment_terms ?? "");
  setValue("payment_details", doc.payment_details ?? details?.payment_details ?? "");
  setValue("withholdings", doc.withholdings ?? details?.withholdings ?? "");
  setValue("tax_notes", doc.tax_notes ?? details?.tax_notes ?? "");

  if (ndflRateSelect){
    const ndflValue = doc.ndfl_rate ?? details?.ndfl_rate ?? 13;
    ndflRateSelect.value = String(ndflValue);
    ndflRateSelect.dataset.manual = "true";
  }

  if (insuranceSelect){
    const insuranceRaw = doc.insurance_required ?? details?.insurance_required;
    const value = insuranceRaw === false ? "no" : "yes";
    insuranceSelect.value = value;
    insuranceSelect.dataset.manual = "true";
  }

  if (onlyAfterActCheckbox){
    const onlyAfter = doc.only_after_act ?? details?.only_after_act ?? false;
    onlyAfterActCheckbox.checked = Boolean(onlyAfter);
  }

  if (existingDoc){
    const executorName = doc.executor_name ?? details?.executor_name ?? existingDoc.executor_name ?? null;
    const payerName = doc.payer_name ?? details?.payer_name ?? existingDoc.payer_name ?? null;
    if (executorName){
      existingDoc.executor_name = executorName;
      existingDoc.counterparty_name = executorName;
    }
    if (payerName){
      existingDoc.payer_name = payerName;
    }
    existingDoc.counterparty_id = payerId || null;
    existingDoc.counterparty2_id = executorId || null;
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
    const payload = await buildPayload({ statusOverride: isSubmit ? "in_review" : null });
    if (!payload){
      setBusy(false);
      return;
    }

    const selectedEntries = approvalPicker?.getSelectedEntries ? approvalPicker.getSelectedEntries() : [];
    const selectedApprovers = selectedEntries.map(entry => entry.id);
    const hadApproval = Boolean(existingDoc?.approval_id);

    if (isSubmit && !hadApproval && !selectedApprovers.length){
      revealApprovalSection();
      approvalFlow.showApproverSection();
      openApproverModal();
      showMessage("Добавьте хотя бы одного согласующего перед отправкой.", true);
      setBusy(false);
      return;
    }

    let docRecord;

    if (existingDoc){
      docRecord = await updateDoc(existingDoc.id, payload);
    } else {
      docRecord = await createDoc(payload);
      currentDocId = docRecord?.id ?? null;
    }

    const docId = docRecord?.id ?? currentDocId ?? null;
    const approvalId = docRecord?.approval_id ?? existingDoc?.approval_id ?? null;
    const executorName = resolveExecutorName(payload.counterparty2_id || payload.executor_id);
    const payerName = resolvePayerName(payload.counterparty_id || payload.payer_id);

    existingDoc = {
      ...(existingDoc || {}),
      ...docRecord,
      approval_id: approvalId,
      counterparty_name: executorName,
      executor_name: executorName,
      payer_name: payerName,
      counterparty_id: payload.counterparty_id || payload.payer_id || null,
      counterparty2_id: payload.counterparty2_id || payload.executor_id || null,
      only_after_act: payload.only_after_act,
      ndfl_rate: payload.ndfl_rate,
      insurance_required: payload.insurance_required,
      payment_terms: payload.payment_terms,
      payment_details: payload.payment_details,
      withholdings: payload.withholdings,
      tax_notes: payload.tax_notes,
      amount: payload.amount,
      period_start: payload.period_start,
      period_end: payload.period_end,
      work_volume: payload.work_volume,
      curator: payload.curator,
      details: payload.details
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
    console.error("[contracts-service-gph] save error", error?.message || error, error);
    const errorText = error?.message || error?.details || "Не удалось сохранить договор. Проверьте заполненные поля.";
    showMessage(errorText, true);
  }finally{
    setBusy(false);
  }
}

async function buildPayload({ statusOverride } = {}){
  const title = valueOf("title");
  const number = valueOf("number");
  const docDate = valueOf("doc_date");
  const objectId = valueOf("fldObject");
  const payerId = valueOf("fldPayer");
  const executorId = valueOf("fldExecutor");
  const serviceScope = valueOf("service_scope");
  const paymentTerms = valueOf("payment_terms");
  const amountValue = normalizeAmount(valueOf("amount"));
  const periodStart = valueOf("period_start") || null;
  const periodEnd = valueOf("period_end") || null;
  const workVolume = valueOf("work_volume") || null;
  const curatorValue = valueOf("curator") || null;
  const paymentDetails = valueOf("payment_details") || null;
  const withholdings = valueOf("withholdings") || null;
  const taxNotes = valueOf("tax_notes") || null;
  const notesValue = valueOf("notes") || null;

  const errors = [];
  if (!title) errors.push("Заполните «Название документа».");
  if (!number) errors.push("Укажите номер договора.");
  if (!docDate) errors.push("Укажите дату договора.");
  if (!objectId) errors.push("Выберите объект.");
  if (!payerId) errors.push("Выберите плательщика.");
  if (!executorId) errors.push("Выберите исполнителя.");
  if (payerId && executorId && payerId === executorId){
    errors.push("Плательщик и исполнитель не могут совпадать.");
  }
  if (!serviceScope) errors.push("Опишите предмет / вид услуг.");
  if (!paymentTerms) errors.push("Укажите порядок расчётов.");
  if (amountValue === null || Number.isNaN(amountValue) || amountValue <= 0){
    errors.push("Введите сумму вознаграждения больше нуля.");
  }

  const needsFile = !existingDoc;
  const file = fileInput?.files?.[0];
  if (needsFile && !file){
    errors.push("Приложите файл договора.");
  }

  if (errors.length){
    showMessage(errors.join(" "), true);
    return null;
  }

  const ndflValue = ndflRateSelect ? ndflRateSelect.value || "13" : "13";
  const insuranceValue = insuranceSelect ? insuranceSelect.value || "yes" : "yes";
  const executorName = resolveExecutorName(executorId);
  const payerName = resolvePayerName(payerId);

  const onlyAfterAct = Boolean(onlyAfterActCheckbox?.checked);

  const payload = {
    category: CATEGORY,
    subtype: SUBTYPE,
    title,
    number,
    doc_date: docDate || null,
    object_id: objectId || null,
    counterparty_id: payerId || null,
    counterparty2_id: executorId || null,
    payer_id: payerId || null,
    executor_id: executorId || null,
    payer_name: payerName,
    executor_name: executorName,
    period_start: periodStart,
    period_end: periodEnd,
    work_volume: workVolume,
    curator: curatorValue,
    amount: amountValue,
    payment_terms: paymentTerms,
    payment_details: paymentDetails,
    only_after_act: onlyAfterAct,
    ndfl_rate: Number(ndflValue) || 13,
    insurance_required: insuranceValue !== "no",
    withholdings,
    tax_notes: taxNotes,
    notes: notesValue,
    status: statusOverride ?? (existingDoc?.status || "draft")
  };

  const details = {
    service_scope: serviceScope,
    period_start: periodStart,
    period_end: periodEnd,
    work_volume: workVolume,
    curator: curatorValue,
    payment_terms: paymentTerms,
    payment_details: paymentDetails,
    only_after_act: onlyAfterAct,
    ndfl_rate: Number(ndflValue) || 13,
    insurance_required: insuranceValue !== "no",
    withholdings,
    tax_notes,
    payer_name: payerName,
    executor_name: executorName
  };

  payload.details = details;

  if (file){
    const uploaded = await uploadFile(file, CATEGORY, SUBTYPE, { folder: "documents/gph" });
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

  return payload;
}

async function hydrateExecutorDefaults(executorId){
  if (!executorId) return;
  const key = String(executorId);
  try{
    let info = counterpartyCache.get(key);
    if (!info){
      info = await fetchCounterpartyDetails(executorId);
      if (info){
        counterpartyCache.set(key, info);
      }
    }
    if (!info) return;
    applyExecutorDefaults(info);
  }catch(error){
    console.warn("[contracts-service-gph] executor defaults error", error);
  }
}

function applyExecutorDefaults(details){
  if (!details) return;

  if (ndflRateSelect && ndflRateSelect.dataset.manual !== "true"){
    ndflRateSelect.value = deriveNdflRate(details);
  }

  if (insuranceSelect && insuranceSelect.dataset.manual !== "true"){
    insuranceSelect.value = deriveInsuranceRequirement(details);
  }

  if (paymentDetailsField){
    const autoValue = buildPaymentDetails(details);
    const shouldApply = autoValue && (paymentDetailsField.dataset.autofill === "true" || !paymentDetailsField.value.trim());
    if (shouldApply){
      paymentDetailsField.value = autoValue;
      paymentDetailsField.dataset.autofill = "true";
    }
  }
}

function deriveNdflRate(details = {}){
  if (details.tax_status === "nonresident"){
    return "30";
  }
  if (details.self_status === "sole_proprietor"){
    return "15";
  }
  return "13";
}

function deriveInsuranceRequirement(details = {}){
  if (details.self_status === "self_employed" || details.self_status === "sole_proprietor"){
    return "no";
  }
  return "yes";
}

function buildPaymentDetails(details = {}){
  const parts = [];
  if (details.bank_name) parts.push(`Банк: ${details.bank_name}`);
  if (details.bank_bik) parts.push(`БИК: ${details.bank_bik}`);
  if (details.bank_account) parts.push(`Счёт: ${details.bank_account}`);
  return parts.join("\n");
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
    counterparty_name: getExecutorNameFromRecord(doc),
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
    const rect = panel.getBoundingClientRect();
    const minGap = 32;
    let offset = (window.innerHeight - rect.height) / 2;
    const maxTop = window.innerHeight - rect.height - minGap;
    offset = Math.max(minGap, Math.min(offset, Math.max(maxTop, minGap)));
    approverModal.style.setProperty("--modal-offset", `${Math.round(offset)}px`);
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
    console.error("[contracts-service-gph] persistCurrentApproverSelection", error);
    throw error;
  }
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
  const uniqueIds = Array.from(new Set(orderedIds));
  const approverNames = uniqueIds.map(id => nameMap.get(id) || "");
  try{
    const { data: updatedRow, error: updateError } = await supabase
      .from("document_approval_assignments")
      .update({
        approver_ids: uniqueIds,
        approver_names: approverNames,
        status: uniqueIds.length ? "in_review" : "draft"
      })
      .eq("id", assignmentId)
      .select("approver_ids")
      .single();
    if (updateError) throw updateError;
    const resultIds = Array.isArray(updatedRow?.approver_ids)
      ? updatedRow.approver_ids.map(id => String(id))
      : uniqueIds;
    return resultIds;
  }catch(error){
    console.error("[contracts-service-gph] updateApprovalAssignment error", error);
    throw error;
  }
}

function toggleActionButtons(status){
  const normalized = String(status || "").toLowerCase();
  const isDraft = !normalized || normalized === "draft" || normalized === "черновик";
  if (btnSave){
    btnSave.disabled = false;
  }
  if (btnSubmitApproval){
    btnSubmitApproval.disabled = !isDraft && normalized !== "in_review";
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

function setValue(id, value){
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === "checkbox"){
    el.checked = Boolean(value);
    return;
  }
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

function parseDetails(raw){
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  return safeParse(raw);
}

function getExecutorNameFromRecord(record){
  if (!record) return null;
  if (record.executor_name) return record.executor_name;
  if (record.counterparty_name) return record.counterparty_name;
  const details = parseDetails(record.details);
  return details?.executor_name || null;
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

function safeParse(str){
  try{
    return JSON.parse(str);
  }catch(_){
    return null;
  }
}

async function syncApproval(record, options = {}){
  if (!record) return;
  await approvalFlow.sync(record, options);
  revealApprovalSection();
  showApprovalCard();
  removeApprovalHint();
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

function resolveExecutorName(executorId){
  if (!executorId){
    return existingDoc?.executor_name || existingDoc?.counterparty_name || existingDoc?.details?.executor_name || null;
  }
  const selector = `option[value="${executorId}"]`;
  const option = fldExecutor?.querySelector(selector);
  if (option){
    const label = option.textContent?.trim();
    if (label) return label;
  }
  return existingDoc?.executor_name || existingDoc?.counterparty_name || existingDoc?.details?.executor_name || null;
}

function resolvePayerName(payerId){
  if (!payerId){
    return existingDoc?.payer_name || existingDoc?.details?.payer_name || null;
  }
  const selector = `option[value="${payerId}"]`;
  const option = fldPayer?.querySelector(selector);
  if (option){
    const label = option.textContent?.trim();
    if (label) return label;
  }
  return existingDoc?.payer_name || existingDoc?.details?.payer_name || null;
}

function escapeHtml(value){
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
