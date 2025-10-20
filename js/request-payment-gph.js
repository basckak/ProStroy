import supabase, { requireSession } from "../supabaseClient.js";
import { createApprovalPicker } from "../approvalPicker.js";
import { createApprovalFlow } from "../approvalFlow.js";
import {
  fetchObjects,
  fetchCounterpartyDetails,
  normalizeAmount,
  uploadFile,
  publicUrl
} from "./documents-api.js";

const headerReady = window.headerReady || Promise.resolve();
const TABLE = "gph_payment_requests";
const STORAGE_FOLDER = "requests/gph";

const STATUS_META = {
  draft: { label: "Черновик", pill: "status-draft" },
  in_review: { label: "На согласовании", pill: "status-on_review" },
  approved: { label: "Согласовано", pill: "status-approved" },
  finalized: { label: "Оплачено", pill: "status-completed" },
  final: { label: "Оплачено", pill: "status-completed" },
  rejected: { label: "Отклонено", pill: "status-rejected" }
};

let currentSession = null;
let existingRecord = null;
let currentRecordId = null;

const contractCache = new Map();
const performerCache = new Map();

let formModeLabel;
let statusPill;
let contractSummary;
let performerInfoBox;
let contractSelect;
let periodStartInput;
let periodEndInput;
let executorNameInput;
let executorTypeSelect;
let executorInnInput;
let executorSnilsInput;
let executorBankInput;
let netAmountInput;
let ndflRateSelect;
let insurancePercentInput;
let totalAmountInput;
let ndflAmountHint;
let insuranceAmountHint;
let ndflExtraHint;
let insuranceExtraHint;
let objectSelect;
let objectHint;
let fileInput;
let fileHint;
let notesInput;
let btnSave;
let btnSubmit;
let messageBox;
let approvalSection;
let approvalBlockCard;
let approvalBlockHint;
let approverPickerField;
let approverModal;
let approverModalClose;
let approverModalCancel;
let approverModalApply;

let approvalPicker = null;
let approvalFlow = null;

export async function init(){
  await headerReady;
  currentSession = await requireSession({ redirectTo: "/index.html" });
  currentRecordId = new URLSearchParams(location.search).get("id");

  renderLayout();
  cacheElements();
  initApproval();
  bindEvents();
  try{
    await approvalPicker.loadDirectory();
  }catch(error){
    console.error("[gph-payment] approver load error", error);
  }

  if (currentRecordId){
    existingRecord = await loadExisting(currentRecordId);
  }

  await Promise.all([
    loadContracts(existingRecord),
    loadObjects(existingRecord)
  ]);

  if (existingRecord){
    await populateForm(existingRecord);
    await syncApproval(buildApprovalRecord(existingRecord), { session: currentSession });
  } else {
    updateStatus("draft");
    setMode("create");
    showApprovalCard();
    approvalFlow.hideApproverSection();
  }

  if (fileInput && existingRecord?.file_path){
    const url = publicUrl(existingRecord.file_path);
    if (url){
      fileHint.innerHTML = `<a href="${url}" target="_blank" rel="noopener">Текущий файл: ${escapeHtml(existingRecord.file_name || "скачать")}</a>`;
    }
  }

  supabase.auth.onAuthStateChange((_event, session)=>{
    if (!session){
      location.replace("/index.html");
      return;
    }
    currentSession = session;
    approvalPicker.loadDirectory().catch(error=>{
      console.error("[gph-payment] approver reload error", error);
    });
  });
}

function renderLayout(){
  const card = document.querySelector(".card");
  if (!card) return;
  card.classList.add("gph-payment-card");
  card.innerHTML = `
    <header class="gph-header">
      <div class="gph-header__text">
        <p id="formModeLabel" class="form-mode">Создание</p>
        <h1>Заявка на оплату по ГПХ</h1>
        <p class="muted">Выберите договор ГПХ, проверьте данные исполнителя и подготовьте заявку на перечисление вознаграждения.</p>
      </div>
      <div id="docStatusPill" class="status-badge status-draft">Черновик</div>
    </header>

    <section class="gph-card-info">
      <div id="contractSummary" class="gph-summary"></div>
      <div id="performerMetadata" class="gph-info-box" hidden></div>
    </section>

    <form id="gphPaymentForm" class="gph-payment-form" novalidate>
      <section class="gph-field-group">
        <div class="gph-section-head">
          <h2 class="gph-section-title">Реквизиты заявки</h2>
        </div>
        <div class="gph-field-row">
          <div class="gph-field">
            <label for="reqNumber">Номер заявки<span class="req">*</span></label>
            <input id="reqNumber" autocomplete="off" placeholder="ЗГПХ-2025/08" required>
          </div>
          <div class="gph-field">
            <label for="reqDate">Дата заявки<span class="req">*</span></label>
            <input id="reqDate" type="date" required>
          </div>
          <div class="gph-field">
            <label for="contractSelect">Основание платежа<span class="req">*</span></label>
            <select id="contractSelect" required>
              <option value="">— выберите договор ГПХ —</option>
            </select>
          </div>
        </div>
        <div class="gph-field-row">
          <div class="gph-field">
            <label for="periodStart">Период выполнения — с</label>
            <input id="periodStart" type="date">
          </div>
          <div class="gph-field">
            <label for="periodEnd">Период выполнения — по</label>
            <input id="periodEnd" type="date">
          </div>
        </div>
      </section>

      <section class="gph-field-group">
        <div class="gph-section-head">
          <h2 class="gph-section-title">Исполнитель</h2>
          <p class="gph-section-subtitle">Проверьте корректность реквизитов. Поля доступны для редактирования.</p>
        </div>
        <div class="gph-field-row">
          <div class="gph-field">
            <label for="executorName">ФИО исполнителя<span class="req">*</span></label>
            <input id="executorName" placeholder="Например: Иванов Иван Иванович" required>
          </div>
          <div class="gph-field">
            <label for="executorType">Тип исполнителя</label>
            <select id="executorType">
              <option value="individual">Физ лицо</option>
              <option value="self_employed">Самозанятый</option>
              <option value="sole_proprietor">ИП</option>
            </select>
          </div>
        </div>
        <div class="gph-field-row">
          <div class="gph-field">
            <label for="executorInn">ИНН</label>
            <input id="executorInn" placeholder="12 цифр">
          </div>
          <div class="gph-field">
            <label for="executorSnils">СНИЛС</label>
            <input id="executorSnils" placeholder="000-000-000 00">
          </div>
        </div>
        <div class="gph-field">
          <label for="executorBank">Счёт для перечисления</label>
          <textarea id="executorBank" placeholder="Банк, БИК, счёт"></textarea>
          <div class="gph-hint">Реквизиты можно отредактировать перед отправкой.</div>
        </div>
      </section>

      <section class="gph-field-group">
        <div class="gph-section-head">
          <h2 class="gph-section-title">Финансовые данные</h2>
          <p class="gph-section-subtitle">Введите сумму «на руки» — система рассчитает удержания и итоговую сумму к перечислению.</p>
        </div>
        <div class="gph-amount-grid">
          <div class="gph-field">
            <label for="netAmount">Сумма к выплате (на руки), ₽<span class="req">*</span></label>
            <input id="netAmount" inputmode="decimal" placeholder="0,00" required>
            <div class="gph-hint">Фактическая сумма, которую должен получить исполнитель.</div>
          </div>
          <div class="gph-field">
            <label for="ndflRate">Ставка НДФЛ<span class="req">*</span></label>
            <select id="ndflRate">
              <option value="13">13%</option>
              <option value="15">15%</option>
              <option value="30">30%</option>
            </select>
            <div class="gph-hint">НДФЛ: <span id="ndflAmountHint">0,00 ₽</span></div>
          </div>
          <div class="gph-field">
            <label for="insurancePercent">Страховые взносы, %</label>
            <input id="insurancePercent" inputmode="decimal" placeholder="0">
            <div class="gph-hint">Взносы: <span id="insuranceAmountHint">0,00 ₽</span></div>
          </div>
          <div class="gph-field">
            <label for="totalAmount">Итоговая сумма к перечислению, ₽</label>
            <input id="totalAmount" class="gph-readonly" readonly value="0,00">
            <div class="gph-hint">Учитывает НДФЛ и страховые взносы.</div>
          </div>
        </div>
        <div class="gph-amount-summary">
          <span>НДФЛ: <strong id="ndflExtraHint">0,00 ₽</strong></span>
          <span>Страховые взносы: <strong id="insuranceExtraHint">0,00 ₽</strong></span>
        </div>
        <div class="gph-field-row">
          <div class="gph-field">
            <label for="objectSelect">Источник финансирования / статья затрат</label>
            <select id="objectSelect">
              <option value="">— выбрать объект —</option>
            </select>
            <div id="objectHint" class="gph-hint">Загрузка объектов…</div>
          </div>
        </div>
      </section>

      <section class="gph-field-group">
        <div class="gph-section-head">
          <h2 class="gph-section-title">Связанные документы</h2>
          <p class="gph-section-subtitle">Приложите акт выполненных работ или отчёт исполнителя.</p>
        </div>
        <div class="gph-field">
          <label for="fileAct">Приложить акт / отчёт<span class="req">*</span></label>
          <div class="gph-file">
            <input id="fileAct" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx">
            <div id="fileHint" class="gph-hint">Форматы: PDF, DOC, XLS. Размер до 20 МБ.</div>
          </div>
        </div>
        <div class="gph-field">
          <label for="accountingNotes">Комментарий для бухгалтерии</label>
          <textarea id="accountingNotes" placeholder="Дополнительные пояснения для бухгалтерии"></textarea>
        </div>
      </section>

      <div id="formMessage" class="gph-message"></div>

      <div class="gph-button-row">
        <button id="btnSave" type="button" class="btn link" data-action="save">Сохранить черновик</button>
        <button id="btnSubmitApproval" type="button" class="btn action" data-action="submit">Отправить на согласование</button>
      </div>
    </form>

    <section id="approvalSection" class="approval-section" hidden>
      <div class="approval-section__head">
        <div>
          <h2 class="approval-section__title">Согласование заявки</h2>
          <p class="approval-section__description">Назначьте согласующих и отслеживайте статус выполнения заявки.</p>
        </div>
      </div>
      <div class="approval-section__body">
        <div id="approvalBlockCard" class="approval-card" hidden>
          <div class="muted" id="approvalBlockHint">После назначения и отправки заявка обновит статусы автоматически.</div>
          <div id="approval-block-mount"></div>
        </div>
      </div>
      <div id="approverModal" class="approver-modal" hidden>
        <div class="approver-modal__panel">
          <div class="approver-modal__head">
            <h3 class="approver-modal__title">Назначить согласующих</h3>
            <button type="button" class="approver-modal__close" id="approverModalClose" aria-label="Закрыть окно">&times;</button>
          </div>
          <div class="approver-modal__body">
            <div class="field" id="approverPickerField" hidden>
              <label for="approversSearch">Выберите сотрудников</label>
              <div id="approversSelect" class="approver-search">
                <div id="approversDisplay" class="approver-selected empty" aria-live="polite"></div>
                <input id="approversSearch" class="approver-search__input" type="search" placeholder="Начните вводить фамилию, должность или email" autocomplete="off" spellcheck="false">
                <div id="approversOptions" class="approver-options"></div>
              </div>
              <div class="hint" id="approversHelp">Начните вводить фамилию или email.</div>
            </div>
          </div>
          <div class="approver-modal__actions">
            <button type="button" class="btn link" id="approverModalCancel">Отмена</button>
            <button type="button" class="btn action" id="approverModalApply">Готово</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function cacheElements(){
  formModeLabel = document.getElementById("formModeLabel");
  statusPill = document.getElementById("docStatusPill");
  contractSummary = document.getElementById("contractSummary");
  performerInfoBox = document.getElementById("performerMetadata");
  contractSelect = document.getElementById("contractSelect");
  periodStartInput = document.getElementById("periodStart");
  periodEndInput = document.getElementById("periodEnd");
  executorNameInput = document.getElementById("executorName");
  executorTypeSelect = document.getElementById("executorType");
  executorInnInput = document.getElementById("executorInn");
  executorSnilsInput = document.getElementById("executorSnils");
  executorBankInput = document.getElementById("executorBank");
  netAmountInput = document.getElementById("netAmount");
  ndflRateSelect = document.getElementById("ndflRate");
  insurancePercentInput = document.getElementById("insurancePercent");
  totalAmountInput = document.getElementById("totalAmount");
  ndflAmountHint = document.getElementById("ndflAmountHint");
  insuranceAmountHint = document.getElementById("insuranceAmountHint");
  ndflExtraHint = document.getElementById("ndflExtraHint");
  insuranceExtraHint = document.getElementById("insuranceExtraHint");
  objectSelect = document.getElementById("objectSelect");
  objectHint = document.getElementById("objectHint");
  fileInput = document.getElementById("fileAct");
  fileHint = document.getElementById("fileHint");
  notesInput = document.getElementById("accountingNotes");
  btnSave = document.getElementById("btnSave");
  btnSubmit = document.getElementById("btnSubmitApproval");
  messageBox = document.getElementById("formMessage");
  approvalSection = document.getElementById("approvalSection");
  approvalBlockCard = document.getElementById("approvalBlockCard");
  approvalBlockHint = document.getElementById("approvalBlockHint");
  approverPickerField = document.getElementById("approverPickerField");
  approverModal = document.getElementById("approverModal");
  approverModalClose = document.getElementById("approverModalClose");
  approverModalCancel = document.getElementById("approverModalCancel");
  approverModalApply = document.getElementById("approverModalApply");
}

function initApproval(){
  approvalPicker = createApprovalPicker({
    supabase,
    wrapper: "approversSelect",
    display: "approversDisplay",
    search: "approversSearch",
    options: "approversOptions",
    help: "approversHelp"
  });

  approvalFlow = createApprovalFlow({
    docKind: "gph_payment",
    tableName: TABLE,
    supabase,
    requireSession,
    approvalPicker,
    mountSection: "approvalSection",
    approverSection: "approverPickerField",
    buildTitle: record => {
      const parts = [];
      if (record.request_number){
        parts.push(`Заявка ${record.request_number}`);
      } else {
        parts.push("Заявка на оплату по ГПХ");
      }
      if (record.performer_name){
        parts.push(record.performer_name);
      }
      return parts.join(" · ");
    },
    resolveObjectId: record => record.object_id || null,
    onApprovalEstablished: (newApprovalId)=>{
      if (!existingRecord) existingRecord = {};
      existingRecord.approval_id = newApprovalId;
      removeApprovalHint();
      closeApproverModal();
    },
    onApprovalRemoved: ()=>{
      if (!existingRecord) existingRecord = {};
      existingRecord.approval_id = null;
      existingRecord.status = "draft";
      approvalPicker?.setSelected?.([]);
      approvalPicker?.reset?.();
      showApprovalCard();
      showMessage("Согласование удалено. Назначьте новых согласующих.", false);
    }
  });

  approvalFlow.hideApproverSection();
}

function bindEvents(){
  contractSelect?.addEventListener("change", async ()=>{
    const contractId = contractSelect.value;
    if (!contractId){
      contractSummary.textContent = "";
      performerInfoBox.hidden = true;
      return;
    }
    await applyContract(contractId);
  });

  netAmountInput?.addEventListener("input", ()=>{
    recalculateTotals({ showError: false });
  });
  netAmountInput?.addEventListener("blur", ()=>{
    formatAmountField(netAmountInput);
    recalculateTotals({ showError: false });
  });

  ndflRateSelect?.addEventListener("change", ()=>{
    recalculateTotals({ showError: false });
  });

  insurancePercentInput?.addEventListener("input", ()=>{
    recalculateTotals({ showError: false });
  });
  insurancePercentInput?.addEventListener("blur", ()=>{
    formatPercentField(insurancePercentInput);
    recalculateTotals({ showError: false });
  });

  btnSave?.addEventListener("click", async ()=>{
    await handleSubmit({ statusOverride: "draft" });
  });

  btnSubmit?.addEventListener("click", async ()=>{
    await handleSubmit({ statusOverride: "in_review", requireApprover: true });
  });

  fileInput?.addEventListener("change", ()=>{
    const file = fileInput.files?.[0];
    if (!file){
      fileHint.textContent = "Форматы: PDF, DOC, XLS. Размер до 20 МБ.";
      return;
    }
    const sizeMb = (file.size / 1024 / 1024).toFixed(2);
    fileHint.textContent = `${file.name} • ${sizeMb} МБ`;
  });

  approverModalClose?.addEventListener("click", closeApproverModal);
  approverModalCancel?.addEventListener("click", closeApproverModal);
  approverModalApply?.addEventListener("click", async ()=>{
    closeApproverModal();
    await persistCurrentApproverSelection({ refresh: true }).catch(error=>{
      console.warn("[gph-payment] persist approvers failed", error);
    });
  });

  approverModal?.addEventListener("click", event=>{
    if (event.target === approverModal){
      closeApproverModal();
    }
  });

  document.addEventListener("click", event=>{
    const trigger = event.target.closest("[data-open-approver-modal]");
    if (trigger){
      event.preventDefault();
      openApproverModal();
    }
  });

  document.addEventListener("keydown", event=>{
    if (event.key === "Escape" && approverModal && !approverModal.hidden){
      event.preventDefault();
      closeApproverModal();
    }
  });
}

async function loadContracts(prefill){
  try{
    const { data, error } = await supabase
      .from("request_documents")
      .select("id, title, number, doc_date, status, details, counterparty2_id, object_id")
      .eq("subtype", "service_gph")
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const select = contractSelect;
    if (!select) return;
    select.innerHTML = '<option value="">— выберите договор ГПХ —</option>';
    contractCache.clear();

    (data || []).forEach(contract=>{
      const parsed = parseDetails(contract.details);
      const performerName = parsed?.executor_name || parsed?.performer_name || parsed?.counterparty_name || "";
      contractCache.set(contract.id, { ...contract, _details: parsed, performer_name: performerName });
      const option = document.createElement("option");
      const parts = [];
      if (contract.number) parts.push(`№ ${contract.number}`);
      if (contract.title) parts.push(contract.title);
      if (performerName) parts.push(performerName);
      option.value = contract.id;
      option.textContent = parts.join(" · ") || `Договор ${contract.id.slice(0,6)}`;
      option.dataset.status = contract.status || "draft";
      select.appendChild(option);
    });

    if (prefill?.contract_id){
      if (!contractCache.has(prefill.contract_id)){
        const option = document.createElement("option");
        option.value = prefill.contract_id;
        option.textContent = prefill.contract_title || `Договор ${prefill.contract_id.slice(0,6)}`;
        option.dataset.status = prefill.contract_status || "draft";
        select.appendChild(option);
      }
      select.value = prefill.contract_id;
    }
  }catch(error){
    console.error("[gph-payment] load contracts error", error);
    showMessage("Не удалось загрузить договоры ГПХ. Попробуйте обновить страницу.", true);
  }
}

async function loadObjects(prefill){
  try{
    const objects = await fetchObjects();
    if (!objectSelect) return;
    objectSelect.innerHTML = '<option value="">— выбрать объект —</option>';
    objects.forEach(obj=>{
      const opt = document.createElement("option");
      opt.value = obj.id;
      opt.textContent = obj.name;
      objectSelect.appendChild(opt);
    });
    if (prefill?.object_id){
      const exists = Array.from(objectSelect.options).some(opt=>opt.value === String(prefill.object_id));
      if (!exists){
        const opt = document.createElement("option");
        opt.value = prefill.object_id;
        opt.textContent = prefill.object_name || `(Объект ${prefill.object_id.slice(0,6)})`;
        objectSelect.appendChild(opt);
      }
      objectSelect.value = prefill.object_id;
    }
    if (objectHint){
      objectHint.textContent = "При необходимости выберите объект или статью затрат.";
    }
  }catch(error){
    console.error("[gph-payment] load objects error", error);
    if (objectHint){
      objectHint.textContent = "Не удалось загрузить объекты.";
    }
  }
}

async function applyContract(contractId){
  const contract = contractCache.get(contractId);
  if (!contract){
    showMessage("Не удалось получить данные договора. Попробуйте выбрать снова.", true);
    return;
  }
  const details = contract._details || parseDetails(contract.details);
  const performerId = contract.counterparty2_id || null;
  let performer = performerId ? performerCache.get(performerId) : null;
  if (performerId && !performer){
    try{
      performer = await fetchCounterpartyDetails(performerId);
      if (performer){
        performerCache.set(performerId, performer);
      }
    }catch(error){
      console.warn("[gph-payment] performer load failed", error);
    }
  }

  setValue("periodStart", formatDate(details?.period_start || details?.start_date));
  setValue("periodEnd", formatDate(details?.period_end || details?.end_date));
  setValue("executorName", contract.performer_name || details?.executor_name || "");
  if (executorTypeSelect){
    executorTypeSelect.value = determinePerformerType(performer).value;
  }
  setValue("executorInn", performer?.inn || details?.executor_inn);
  setValue("executorSnils", performer?.snils || details?.executor_snils);
  executorBankInput.value = details?.payment_details || formatBankDetails(performer) || "";

  if (ndflRateSelect){
    ndflRateSelect.value = String(deriveNdflRate({ details, counterparty: performer }));
  }
  if (insurancePercentInput){
    insurancePercentInput.value = formatPercentDisplay(resolveInsurancePercent(details));
  }

  if (objectSelect && contract.object_id){
    const exists = Array.from(objectSelect.options).some(opt=>opt.value === String(contract.object_id));
    if (!exists){
      const opt = document.createElement("option");
      opt.value = contract.object_id;
      opt.textContent = details?.object_name || `Объект ${contract.object_id.slice(0,6)}`;
      objectSelect.appendChild(opt);
    }
    objectSelect.value = contract.object_id;
  }

  updateContractSummary(contract, details);
  updatePerformerMetadata(performer, determinePerformerType(performer).label);
  recalculateTotals({ showError: false });
}

async function populateForm(record){
  if (!record) return;
  setMode("edit");
  updateStatus(record.status || "draft");

  setValue("reqNumber", record.request_number);
  setValue("reqDate", formatDate(record.request_date));
  if (contractSelect){
    contractSelect.value = record.contract_id || "";
  }
  setValue("periodStart", formatDate(record.period_start));
  setValue("periodEnd", formatDate(record.period_end));
  setValue("executorName", record.performer_name);
  if (executorTypeSelect){
    executorTypeSelect.value = record.performer_type || "individual";
  }
  setValue("executorInn", record.performer_inn);
  setValue("executorSnils", record.performer_snils);
  setValue("executorBank", record.bank_details);

  if (ndflRateSelect){
    ndflRateSelect.value = String(record.ndfl_rate ?? 13);
  }
  if (insurancePercentInput){
    insurancePercentInput.value = formatPercentDisplay(record.insurance_percent ?? 0);
  }

  const netValue = record.net_amount ?? (record.amount != null ? record.amount - (record.ndfl_amount ?? 0) - (record.insurance_amount ?? 0) : null);
  netAmountInput.value = netValue != null ? formatAmount(netValue) : "";
  totalAmountInput.value = record.amount != null ? formatAmount(record.amount) : formatAmount(0);
  setAmountHints(record.ndfl_amount ?? 0, record.insurance_amount ?? 0);

  if (objectSelect){
    objectSelect.value = record.object_id || "";
  }
  setValue("accountingNotes", record.notes);

  if (record.contract_id){
    const contract = contractCache.get(record.contract_id);
    const details = contract?._details || parseDetails(contract?.details);
    updateContractSummary(contract || {
      number: record.contract_number,
      doc_date: record.details?.contract_doc_date,
      performer_name: record.performer_name,
      title: record.contract_title
    }, details || record.details);
  }

  if (record.performer_id){
    let performer = performerCache.get(record.performer_id);
    if (!performer){
      try{
        performer = await fetchCounterpartyDetails(record.performer_id);
        if (performer){
          performerCache.set(record.performer_id, performer);
        }
      }catch(error){
        console.warn("[gph-payment] performer info load failed", error);
      }
    }
    const typeLabel = executorTypeSelect?.selectedOptions?.[0]?.textContent || "";
    updatePerformerMetadata(performer, typeLabel);
  } else {
    updatePerformerMetadata(null, "");
  }

  recalculateTotals({ showError: false });
}

function setMode(mode){
  if (!formModeLabel) return;
  formModeLabel.textContent = mode === "edit" ? "Редактирование" : "Создание";
}

function updateStatus(status){
  if (!statusPill) return;
  const meta = STATUS_META[status] || STATUS_META.draft;
  statusPill.textContent = meta.label;
  statusPill.className = `status-badge ${meta.pill}`;
  toggleActionButtons(status);
}

function toggleActionButtons(status){
  const isDraft = !status || status === "draft";
  if (btnSave) btnSave.disabled = false;
  if (btnSubmit) btnSubmit.disabled = !isDraft && status !== "in_review";
}

function showMessage(text, isError = false){
  if (!messageBox) return;
  if (!text){
    messageBox.textContent = "";
    messageBox.className = "gph-message";
    messageBox.style.display = "none";
    return;
  }
  messageBox.textContent = text;
  messageBox.className = `gph-message ${isError ? "err" : "ok"}`;
  messageBox.style.display = "block";
}

function setBusy(state){
  [btnSave, btnSubmit].forEach(btn => {
    if (!btn) return;
    if (!btn.dataset.label){
      btn.dataset.label = btn.textContent || "";
    }
    btn.disabled = state;
    if (state){
      btn.textContent = btn.dataset.action === "submit" ? "Отправляем…" : "Сохраняем…";
    } else {
      btn.textContent = btn.dataset.label;
    }
  });
}

function recalculateTotals({ showError = true } = {}){
  if (!netAmountInput || !totalAmountInput || !ndflRateSelect) return;
  const netValue = normalizeAmount(netAmountInput.value);
  if (netValue === null || Number.isNaN(netValue) || netValue <= 0){
    totalAmountInput.value = formatAmount(0);
    setAmountHints(0, 0);
    return;
  }
  const ndflRate = Number(ndflRateSelect.value || 0);
  const insuranceRate = normalizePercent(insurancePercentInput?.value);
  const rateSum = (ndflRate + insuranceRate) / 100;
  if (rateSum >= 1){
    if (showError){
      showMessage("Сумма ставок НДФЛ и страховых взносов должна быть меньше 100%.", true);
    }
    totalAmountInput.value = "—";
    setAmountHints(0, 0);
    return;
  }
  if (messageBox?.classList.contains("err") && messageBox.textContent.includes("Сумма ставок")){
    showMessage("", false);
  }
  const gross = netValue / (1 - rateSum);
  const ndflAmount = gross * ndflRate / 100;
  const insuranceAmount = gross * insuranceRate / 100;
  totalAmountInput.value = formatAmount(gross);
  setAmountHints(ndflAmount, insuranceAmount);
}

async function handleSubmit({ statusOverride, requireApprover = false } = {}){
  try{
    setBusy(true);
    showMessage("");
    const payload = await buildPayload({ statusOverride });
    if (!payload){
      setBusy(false);
      return;
    }

    if (requireApprover){
      const selected = approvalPicker?.getSelectedEntries?.() ?? [];
      const hasApproval = Boolean(existingRecord?.approval_id);
      if (!hasApproval && !selected.length){
        revealApprovalSection();
        approvalFlow.showApproverSection();
        openApproverModal();
        showMessage("Добавьте хотя бы одного согласующего перед отправкой.", true);
        setBusy(false);
        return;
      }
    }

    let record;
    if (existingRecord){
      record = await updateRecord(existingRecord.id, payload);
    } else {
      record = await createRecord(payload);
    }

    existingRecord = record;
    currentRecordId = record.id;
    const url = new URL(location.href);
    url.searchParams.set("id", record.id);
    history.replaceState({}, "", url.toString());

    if (record.file_path && fileHint){
      const link = publicUrl(record.file_path);
      if (link){
        fileHint.innerHTML = `<a href="${link}" target="_blank" rel="noopener">Текущий файл: ${escapeHtml(record.file_name || "скачать")}</a>`;
      }
    }

    setMode("edit");
    updateStatus(record.status || payload.status || "draft");
    setAmountHints(record.ndfl_amount ?? 0, record.insurance_amount ?? 0);

    const approvalRecord = buildApprovalRecord(record);
    if (statusOverride === "in_review"){
      revealApprovalSection();
      await syncApproval(approvalRecord, { session: currentSession, isNew: !record.approval_id });
      showApprovalCard();
      showMessage("Заявка отправлена на согласование.", false);
      closeApproverModal();
    } else {
      if (record.approval_id){
        await syncApproval(approvalRecord, { session: currentSession });
        showApprovalCard();
      } else {
        approvalFlow.showApproverSection();
      }
      showMessage("Черновик сохранён.", false);
    }

    if (fileInput){
      fileInput.value = "";
    }
  }catch(error){
    console.error("[gph-payment] handle submit error", error);
    showMessage(error?.message || "Не удалось сохранить заявку. Проверьте заполненные поля.", true);
  }finally{
    setBusy(false);
  }
}

async function buildPayload({ statusOverride } = {}){
  const requestNumber = valueOf("reqNumber");
  const requestDate = valueOf("reqDate");
  const contractId = contractSelect?.value || null;
  const performerName = executorNameInput?.value?.trim();
  const netValue = normalizeAmount(netAmountInput?.value);
  const totalValue = normalizeAmount(totalAmountInput?.value);
  const ndflRate = Number(ndflRateSelect?.value || 13);
  const insurancePercent = normalizePercent(insurancePercentInput?.value);
  const ndflAmount = totalValue && !Number.isNaN(totalValue) ? totalValue * ndflRate / 100 : 0;
  const insuranceAmount = totalValue && !Number.isNaN(totalValue) ? totalValue * insurancePercent / 100 : 0;
  const errors = [];
  if (!requestNumber) errors.push("Укажите номер заявки.");
  if (!requestDate) errors.push("Укажите дату заявки.");
  if (!contractId) errors.push("Выберите договор ГПХ.");
  if (!performerName) errors.push("Заполните ФИО исполнителя.");
  if (netValue === null || Number.isNaN(netValue) || netValue <= 0) errors.push("Введите сумму к выплате больше нуля.");
  if (totalValue === null || Number.isNaN(totalValue) || totalValue <= 0) errors.push("Проверьте итоговую сумму. Ставки НДФЛ и взносов должны суммарно быть меньше 100%.");
  if (!existingRecord && !fileInput?.files?.length) errors.push("Приложите акт или отчёт исполнителя.");

  if (errors.length){
    showMessage(errors.join(" "), true);
    return null;
  }

  const contract = contractCache.get(contractId) || {};
  const details = contract._details || parseDetails(contract.details) || {};
  const performerId = contract.counterparty2_id || null;
  const paymentPurpose = buildPurposeTemplate(contract, details) || existingRecord?.payment_purpose || null;

  const payload = {
    request_number: requestNumber,
    request_date: requestDate || null,
    contract_id: contractId,
    contract_number: contract?.number || details?.number || null,
    contract_title: contract?.title || null,
    contract_status: contract?.status || null,
    period_start: valueOf("periodStart") || null,
    period_end: valueOf("periodEnd") || null,
    performer_id: performerId,
    performer_name: performerName,
    performer_type: executorTypeSelect?.value || "individual",
    performer_inn: executorInnInput?.value?.trim() || null,
    performer_snils: executorSnilsInput?.value?.trim() || null,
    bank_details: executorBankInput?.value?.trim() || null,
    amount: totalValue,
    ndfl_rate: ndflRate,
    ndfl_amount: ndflAmount,
    insurance_percent: insurancePercent,
    insurance_withhold: insurancePercent > 0,
    insurance_amount: insuranceAmount,
    net_amount: netValue,
    payment_purpose: paymentPurpose,
    object_id: objectSelect?.value || null,
    notes: notesInput?.value?.trim() || null,
    status: statusOverride ?? (existingRecord?.status || "draft"),
    details: {
      contract_doc_date: contract?.doc_date || details?.doc_date || null,
      contract_period_start: details?.period_start || null,
      contract_period_end: details?.period_end || null,
      performer_type_label: executorTypeSelect?.selectedOptions?.[0]?.textContent || null,
      insurance_percent: insurancePercent,
      ndfl_amount: ndflAmount,
      payment_purpose: paymentPurpose
    }
  };

  const file = fileInput?.files?.[0];
  if (file){
    const uploaded = await uploadFile(file, "requests", "gph", { folder: STORAGE_FOLDER, absolute: true });
    payload.file_path = uploaded.path;
    payload.file_name = uploaded.name || file.name;
    payload.file_size = uploaded.size ?? file.size;
    payload.file_type = uploaded.type || file.type;
  } else if (existingRecord){
    payload.file_path = existingRecord.file_path || null;
    payload.file_name = existingRecord.file_name || null;
    payload.file_size = existingRecord.file_size || null;
    payload.file_type = existingRecord.file_type || null;
  }

  if (!existingRecord){
    payload.created_by = currentSession?.user?.id || null;
  } else {
    payload.updated_by = currentSession?.user?.id || null;
  }

  return payload;
}

async function createRecord(payload){
  const { data, error } = await supabase
    .from(TABLE)
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function updateRecord(id, payload){
  const { data, error } = await supabase
    .from(TABLE)
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function loadExisting(id){
  try{
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  }catch(error){
    console.error("[gph-payment] load existing error", error);
    showMessage("Не удалось загрузить заявку. Проверьте ссылку.", true);
    return null;
  }
}

function valueOf(id){
  const el = document.getElementById(id);
  if (!el) return "";
  return (el.value || "").trim();
}

function setValue(id, value){
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value ?? "";
}

function parseDetails(raw){
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try{
    return JSON.parse(raw);
  }catch(_){
    return null;
  }
}

function determinePerformerType(counterparty){
  const selfStatus = counterparty?.self_status;
  if (selfStatus === "self_employed") return { value: "self_employed", label: "Самозанятый" };
  if (selfStatus === "sole_proprietor") return { value: "sole_proprietor", label: "ИП" };
  return { value: "individual", label: "Физ лицо" };
}

function updateContractSummary(contract, details){
  if (!contractSummary) return;
  if (!contract){
    contractSummary.textContent = "";
    return;
  }
  const parts = [];
  if (contract.number) parts.push(`<strong>Договор:</strong> № ${escapeHtml(contract.number)}`);
  if (contract.doc_date) parts.push(`<strong>от</strong> ${formatDateDisplay(contract.doc_date)}`);
  const performerName = contract.performer_name || details?.executor_name;
  if (performerName) parts.push(`<strong>Исполнитель:</strong> ${escapeHtml(performerName)}`);
  if (details?.service_scope) parts.push(`<strong>Предмет:</strong> ${escapeHtml(details.service_scope)}`);
  const purpose = buildPurposeTemplate(contract, details)?.replace(/\.$/, "");
  if (purpose) parts.push(`<strong>Назначение:</strong> ${escapeHtml(purpose)}`);
  contractSummary.innerHTML = parts.join(" · ");
}

function updatePerformerMetadata(counterparty, typeLabel){
  if (!performerInfoBox) return;
  if (!counterparty){
    performerInfoBox.hidden = true;
    performerInfoBox.textContent = "";
    return;
  }
  const rows = [];
  if (typeLabel) rows.push(`<strong>Тип:</strong> ${escapeHtml(typeLabel)}`);
  if (counterparty.tax_status){
    rows.push(`<strong>Налоговый статус:</strong> ${counterparty.tax_status === "nonresident" ? "Нерезидент РФ" : "Резидент РФ"}`);
  }
  if (counterparty.registration_address){
    rows.push(`<strong>Адрес регистрации:</strong> ${escapeHtml(counterparty.registration_address)}`);
  }
  performerInfoBox.innerHTML = rows.join("<br>");
  performerInfoBox.hidden = false;
}

function formatBankDetails(counterparty){
  if (!counterparty) return "";
  const parts = [];
  if (counterparty.bank_name) parts.push(`Банк: ${counterparty.bank_name}`);
  if (counterparty.bank_bik) parts.push(`БИК: ${counterparty.bank_bik}`);
  if (counterparty.bank_account) parts.push(`Счёт: ${counterparty.bank_account}`);
  return parts.join("\n");
}

function deriveNdflRate({ details, counterparty } = {}){
  if (details?.ndfl_rate) return Number(details.ndfl_rate) || 13;
  if (counterparty?.tax_status === "nonresident") return 30;
  if (counterparty?.self_status === "sole_proprietor") return 15;
  return 13;
}

function resolveInsurancePercent(details){
  if (!details) return 0;
  if (details.insurance_percent !== undefined && details.insurance_percent !== null){
    return Number(details.insurance_percent) || 0;
  }
  if (typeof details.insurance_rate === "number"){
    return Number(details.insurance_rate) || 0;
  }
  return 0;
}

function buildPurposeTemplate(contract, details){
  const number = contract.number || "";
  const date = contract.doc_date ? formatDateDisplay(contract.doc_date) : "";
  const scope = details?.service_scope || "оказанные услуги";
  const start = details?.period_start ? formatDateDisplay(details.period_start) : "";
  const end = details?.period_end ? formatDateDisplay(details.period_end) : "";
  const numberPart = number ? `№ ${number}` : "";
  const datePart = date ? ` от ${date}` : "";
  const periodPart = start && end ? ` за период ${start} — ${end}` : "";
  const base = `Оплата по договору ГПХ ${numberPart}${datePart}`.trim();
  return `${base || "Оплата по договору ГПХ"}${periodPart} (${scope}).`.replace(/\s+/g, " ");
}

function formatAmount(value){
  if (value === null || value === undefined || value === "") return "0,00";
  const num = Number(value);
  if (Number.isNaN(num)) return "0,00";
  return num.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setAmountHints(ndflAmount = 0, insuranceAmount = 0){
  const ndflText = `${formatAmount(ndflAmount)} ₽`;
  const insText = `${formatAmount(insuranceAmount)} ₽`;
  if (ndflAmountHint) ndflAmountHint.textContent = ndflText;
  if (insuranceAmountHint) insuranceAmountHint.textContent = insText;
  if (ndflExtraHint) ndflExtraHint.textContent = ndflText;
  if (insuranceExtraHint) insuranceExtraHint.textContent = insText;
}

function normalizePercent(value){
  const num = normalizeAmount(value);
  if (num === null || Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(99.99, num));
}

function formatPercentDisplay(value){
  if (value === null || value === undefined) return "";
  const num = Number(value);
  if (Number.isNaN(num)) return "";
  const fixed = Number.isInteger(num) ? num.toString() : num.toFixed(2);
  return fixed.replace(".", ",");
}

function formatPercentField(input){
  if (!input) return;
  const value = normalizePercent(input.value);
  input.value = value === 0 ? "0" : formatPercentDisplay(value);
}

function formatAmountField(input){
  if (!input) return;
  const value = normalizeAmount(input.value);
  if (value === null || Number.isNaN(value)){
    input.value = "";
    return;
  }
  input.value = formatAmount(value);
}

function formatDate(value){
  if (!value) return "";
  if (typeof value === "string" && value.includes("T")){
    return value.split("T")[0];
  }
  return value;
}

function formatDateDisplay(value){
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU");
}

function escapeHtml(value){
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function buildApprovalRecord(record){
  if (!record) return null;
  return {
    id: record.id,
    approval_id: record.approval_id,
    title: record.request_number ? `Заявка ${record.request_number}` : record.performer_name,
    number: record.request_number,
    object_id: record.object_id,
    counterparty_name: record.performer_name,
    status: record.status
  };
}

async function syncApproval(record, options = {}){
  if (!record) return;
  await approvalFlow.sync(record, options);
  revealApprovalSection();
  showApprovalCard();
  removeApprovalHint();
}

function showApprovalCard(){
  if (approvalBlockCard) approvalBlockCard.hidden = false;
}

function revealApprovalSection(){
  if (approvalSection) approvalSection.hidden = false;
  approvalFlow.revealMountSection?.();
}

function removeApprovalHint(){
  if (approvalBlockHint) approvalBlockHint.remove();
}

function openApproverModal(){
  if (!approverModal || !approverPickerField) return;
  approverPickerField.hidden = false;
  approverModal.hidden = false;
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
  if (!existingRecord?.approval_id){
    const record = buildApprovalRecord(existingRecord);
    if (record){
      await syncApproval(record, { session: currentSession, isNew: true });
    }
  }
  if (!existingRecord?.approval_id){
    showMessage("Не удалось подготовить согласование. Обновите страницу.", true);
    return;
  }
  const entries = approvalPicker?.getSelectedEntries ? approvalPicker.getSelectedEntries() : [];
  try{
    const saved = await updateApprovalAssignment(existingRecord.approval_id, entries);
    approvalPicker?.setSelected?.(saved);
    approvalPicker?.clearQuery?.();
    if (refresh){
      await approvalFlow.sync(buildApprovalRecord(existingRecord), { session: currentSession });
    }
  }catch(error){
    console.error("[gph-payment] update approvers", error);
    showMessage("Не удалось обновить согласующих.", true);
  }
}

async function updateApprovalAssignment(assignmentId, entries = []){
  if (!assignmentId) return [];
  const ordered = [];
  const nameMap = new Map();
  entries.forEach(entry => {
    const id = entry?.id;
    if (!id) return;
    const strId = String(id);
    if (!nameMap.has(strId)){
      nameMap.set(strId, entry.displayName || entry.name || entry.login || "");
      ordered.push(strId);
    }
  });
  const uniqueIds = Array.from(new Set(ordered));
  const names = uniqueIds.map(id => nameMap.get(id) || "");
  const { data, error } = await supabase
    .from("document_approval_assignments")
    .update({
      approver_ids: uniqueIds,
      approver_names: names,
      status: uniqueIds.length ? "in_review" : "draft"
    })
    .eq("id", assignmentId)
    .select("approver_ids")
    .single();
  if (error) throw error;
  return Array.isArray(data?.approver_ids) ? data.approver_ids : uniqueIds;
}
