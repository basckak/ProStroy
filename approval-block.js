let templateHtml = null;
const FALLBACK_TEMPLATE = `
<div class="approval-block" data-approval-root hidden>
  <section class="approval-card">
    <header class="approval-card__head">
      <div>
        <h2 class="approval-card__title">Согласование</h2>
        <p class="approval-card__subtitle" data-approval-summary>Назначьте согласующих и отслеживайте решения.</p>
      </div>
      <div class="approval-card__status">
        <span class="approval-status status-badge" data-approval-status>—</span>
      </div>
    </header>

    <div class="approval-card__section">
      <h3 class="approval-card__section-title">Согласующие</h3>
      <p class="approval-card__hint" data-approval-manage-hint>Только автор документа может редактировать список согласующих.</p>
      <div class="approval-picker" data-approval-picker>
        <div class="approval-picker__chips" data-approval-selected></div>
        <div class="approval-picker__controls" data-approval-controls>
          <label class="approval-picker__label" for="approvalPickerSelect">Выберите сотрудников:</label>
          <select id="approvalPickerSelect" data-approval-select multiple size="6"></select>
          <div class="approval-picker__buttons">
            <button type="button" class="approval-btn" data-approval-save>Сохранить</button>
            <button type="button" class="approval-btn approval-btn--ghost" data-approval-reset>Сбросить</button>
          </div>
        </div>
        <div class="approval-picker__locked" data-approval-locked hidden>
          <p class="approval-card__hint">Список согласующих недоступен для редактирования.</p>
        </div>
      </div>
    </div>

    <div class="approval-card__section">
      <h3 class="approval-card__section-title">Решения согласующих</h3>
      <div class="approval-decisions" data-approval-decisions>
        <p class="approval-card__hint">Решения ещё не вынесены.</p>
      </div>
    </div>

    <div class="approval-card__section" data-approval-actions hidden>
      <h3 class="approval-card__section-title">Ваше решение</h3>
      <div class="approval-actions">
        <button type="button" class="approval-btn approval-btn--success" data-approval-action="approve">Согласовать</button>
        <button type="button" class="approval-btn approval-btn--danger" data-approval-action="reject">Отклонить</button>
      </div>
    </div>

    <div class="approval-card__section" data-approval-finalize hidden>
      <h3 class="approval-card__section-title">Оформление документа</h3>
      <p class="approval-card__hint">Загрузите финальную версию документа и отметьте его как оформленный.</p>
      <button type="button" class="approval-btn approval-btn--primary" data-approval-finalize>Отметить как оформленный</button>
    </div>
  </section>

  <div class="approval-dialog" data-approval-dialog hidden>
    <div class="approval-dialog__content">
      <h3 class="approval-dialog__title" data-approval-dialog-title>Комментарий</h3>
      <p class="approval-dialog__tip" data-approval-dialog-tip></p>
      <textarea class="approval-dialog__textarea" data-approval-dialog-text placeholder="Введите комментарий..."></textarea>
      <p class="approval-dialog__error" data-approval-dialog-error hidden></p>
      <div class="approval-dialog__actions">
        <button type="button" class="approval-btn approval-btn--primary" data-approval-dialog-save>Сохранить</button>
        <button type="button" class="approval-btn approval-btn--ghost" data-approval-dialog-cancel>Отмена</button>
      </div>
    </div>
  </div>
</div>

<style>
  .approval-block{font-family:inherit;color:inherit}
  .approval-card{background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:22px;display:grid;gap:22px}
  .approval-card__head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
  .approval-card__title{margin:0;font-size:1.4rem}
  .approval-card__subtitle{margin:4px 0 0;color:var(--muted,#a9b4c7);font-size:.95rem}
  .approval-card__status{display:flex;align-items:center}
  .approval-status{font-size:.86rem;letter-spacing:.02em;}
  .approval-card__section{display:grid;gap:12px}
  .approval-card__section-title{margin:0;font-size:1.05rem}
  .approval-card__hint{margin:0;color:var(--muted,#94a3b8);font-size:.9rem}
  .approval-picker{display:grid;gap:12px}
  .approval-picker__chips{display:flex;gap:8px;flex-wrap:wrap}
  .approval-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);font-size:.88rem}
  .approval-chip button{background:none;border:none;color:inherit;font-size:1rem;cursor:pointer;line-height:1;padding:0}
  .approval-picker__controls{display:grid;gap:10px}
  .approval-picker__label{font-size:.9rem;color:var(--muted,#94a3b8)}
  .approval-picker select{width:100%;min-height:140px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);border-radius:12px;color:inherit;padding:8px}
  .approval-picker__buttons{display:flex;gap:8px;flex-wrap:wrap}
  .approval-picker__locked{padding:12px;border:1px dashed rgba(255,255,255,.2);border-radius:12px}
  .approval-decisions{display:grid;gap:12px}
  .approval-decision{padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);display:grid;gap:6px}
  .approval-decision__head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}
  .approval-decision__name{font-weight:600}
  .approval-decision__tag{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:.78rem;border:1px solid rgba(255,255,255,.2)}
  .approval-decision__tag.approved{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.45)}
  .approval-decision__tag.rejected{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.45)}
  .approval-decision__tag.pending{background:rgba(148,163,184,.12);border-color:rgba(148,163,184,.35)}
  .approval-decision__comment{font-size:.88rem;color:var(--muted,#94a3b8)}
  .approval-actions{display:flex;gap:12px;flex-wrap:wrap}
  .approval-btn{cursor:pointer;padding:8px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;font:inherit;font-weight:600}
  .approval-btn:disabled{opacity:.5;cursor:not-allowed}
  .approval-btn--primary{background:linear-gradient(135deg,#22c55e,#16a34a);color:#041d10;border:none}
  .approval-btn--success{background:linear-gradient(135deg,#22c55e,#16a34a);color:#041d10;border:none}
  .approval-btn--danger{background:linear-gradient(135deg,#ef4444,#dc2626);color:#2f0707;border:none}
  .approval-btn--ghost{background:transparent}
  .approval-dialog{position:fixed;inset:0;display:flex;justify-content:center;align-items:center;background:rgba(0,0,0,.65);z-index:1000}
  .approval-dialog__content{background:rgba(11,18,32,.95);border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:22px;max-width:420px;width:100%;display:grid;gap:12px}
  .approval-dialog__title{margin:0;font-size:1.1rem}
  .approval-dialog__tip{margin:0;color:var(--muted,#94a3b8);font-size:.9rem}
  .approval-dialog__textarea{min-height:120px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;padding:10px;resize:vertical}
  .approval-dialog__error{margin:0;color:#fecaca;font-size:.88rem}
  .approval-dialog__actions{display:flex;gap:10px;justify-content:flex-end}
  @media (max-width:640px){
    .approval-picker select{min-height:200px}
    .approval-dialog__content{margin:0 12px}
  }
</style>`;

const STATUS_INFO = {
  draft: { label: "Черновик", css: "status-draft", description: "Документ готовится. Назначьте согласующих и запустите процесс." },
  in_review: { label: "На согласовании", css: "status-on_review", description: "Документ находится на согласовании." },
  approved: { label: "Согласовано", css: "status-approved", description: "Все согласующие одобрили документ." },
  finalized: { label: "Оформлен", css: "status-completed", description: "Финальная версия загружена и оформлена." },
  rejected: { label: "Отклонено", css: "status-rejected", description: "Документ отклонён одним из согласующих." }
};

const DECISION_LABELS = {
  pending: { label: "Ожидает", css: "pending" },
  approved: { label: "Согласовано", css: "approved" },
  rejected: { label: "Отклонено", css: "rejected" }
};

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function formatName(profile){
  if (!profile) return "Сотрудник";
  return profile.full_name?.trim() || profile.login?.trim() || "Сотрудник";
}

function ensureArray(value){
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function uniqueIds(ids){
  return Array.from(new Set(ids.filter(Boolean)));
}

function calcNextStatus(assignment, decisions){
  if (!assignment) return "draft";
  if (assignment.status === "finalized") return "finalized";
  const ids = ensureArray(assignment.approver_ids);
  if (!ids.length) return "draft";
  const decisionMap = new Map();
  decisions.forEach((item)=>{
    decisionMap.set(item.approver_id, item.decision || "pending");
  });
  const hasReject = ids.some((id)=> decisionMap.get(id) === "rejected");
  if (hasReject) return "rejected";
  const allApproved = ids.every((id)=> decisionMap.get(id) === "approved");
  if (allApproved && ids.length) return "approved";
  return "in_review";
}

export async function loadApprovalBlock(options){
  const {
    mount,
    mountSelector = "#approval-block",
    supabase,
    documentId,
    documentType,
    currentUserId,
    currentUserName = "",
    authorId,
    canManageApprovers = false,
    canFinalize = false,
    initialStatus = "draft",
    documentTitle = "",
    documentNumber = "",
    documentUrl = "",
    metadata = null,
    onStatusChange = async ()=>{},
    onFinalize = async ()=>{}
  } = options || {};

  if (!supabase) throw new Error("supabase client is required for approval block");
  if (!documentId || !documentType) throw new Error("documentId и documentType обязательны для approval block");

  let mountNode = mount || document.querySelector(mountSelector);
  if (!mountNode){
    throw new Error(`Не найден контейнер блока согласования: ${mountSelector}`);
  }

  if (!templateHtml){
    try{
      const res = await fetch("./approval-block.html", { cache: "force-cache" });
      if (!res.ok) throw new Error(res.statusText || "template fetch failed");
      templateHtml = await res.text();
    }catch(fetchError){
      console.warn("approval-block: используем встроенный шаблон", fetchError);
      templateHtml = FALLBACK_TEMPLATE;
    }
  }

  mountNode.innerHTML = templateHtml;
  const root = mountNode.querySelector("[data-approval-root]");
  if (!root){
    throw new Error("approval-block: не удалось инициализировать корень компонента");
  }
  root.hidden = false;

  // references
  const statusEl = root.querySelector("[data-approval-status]");
  const summaryEl = root.querySelector("[data-approval-summary]");
  const manageHint = root.querySelector("[data-approval-manage-hint]");
  const picker = root.querySelector("[data-approval-picker]");
  const chipsBox = root.querySelector("[data-approval-selected]");
  const controlsBox = root.querySelector("[data-approval-controls]");
  const lockedBox = root.querySelector("[data-approval-locked]");
  const selectEl = root.querySelector("[data-approval-select]");
  const saveBtn = root.querySelector("[data-approval-save]");
  const resetBtn = root.querySelector("[data-approval-reset]");
  const decisionsBox = root.querySelector("[data-approval-decisions]");
  const actionsSection = root.querySelector("[data-approval-actions]");
  const finalizeSection = root.querySelector("[data-approval-finalize]");
  const finalizeBtn = root.querySelector("[data-approval-finalize]");
  const dialog = root.querySelector("[data-approval-dialog]");
  const dialogTitle = root.querySelector("[data-approval-dialog-title]");
  const dialogTip = root.querySelector("[data-approval-dialog-tip]");
  const dialogTextarea = root.querySelector("[data-approval-dialog-text]");
  const dialogError = root.querySelector("[data-approval-dialog-error]");
  const dialogSave = root.querySelector("[data-approval-dialog-save]");
  const dialogCancel = root.querySelector("[data-approval-dialog-cancel]");

  if (selectEl){
    selectEl.id = `approvalPickerSelect-${documentType}-${documentId}`;
  }

  const canEditApprovers = canManageApprovers || authorId === currentUserId;
  manageHint.hidden = canEditApprovers ? false : true;
  if (canEditApprovers){
    controlsBox.hidden = false;
    lockedBox.hidden = true;
  }else{
    controlsBox.hidden = true;
    lockedBox.hidden = false;
  }

  let assignment = null;
  let decisions = [];
  let profiles = [];

  function applyStatus(nextStatus){
    const info = STATUS_INFO[nextStatus] || STATUS_INFO.draft;
    statusEl.textContent = info.label;
    statusEl.className = `approval-status status-badge ${info.css}`;
    summaryEl.textContent = info.description;
  }

  function renderChips(){
    chipsBox.innerHTML = "";
    const ids = ensureArray(assignment?.approver_ids);
    const names = ensureArray(assignment?.approver_names);
    if (!ids.length){
      const span = document.createElement("span");
      span.className = "approval-card__hint";
      span.textContent = "Согласующие не назначены.";
      chipsBox.appendChild(span);
      return;
    }
    ids.forEach((id, index)=>{
      const chip = document.createElement("div");
      chip.className = "approval-chip";
      const name = names[index] || formatName(profiles.find((p)=>p.id === id));
      chip.textContent = name || "Сотрудник";
      if (canEditApprovers){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = "&times;";
        btn.title = "Убрать из списка";
        btn.addEventListener("click", ()=>{
          const currentIds = ensureArray(assignment?.approver_ids).filter((x)=>x !== id);
          const currentNames = ensureArray(assignment?.approver_names).filter((_, idx)=> assignment?.approver_ids[idx] !== id);
          assignment.approver_ids = currentIds;
          assignment.approver_names = currentNames;
          updateSelectFromAssignment();
          renderChips();
        });
        chip.appendChild(btn);
      }
      chipsBox.appendChild(chip);
    });
  }

  function updateSelectFromAssignment(){
    if (!selectEl) return;
    const ids = new Set(ensureArray(assignment?.approver_ids));
    Array.from(selectEl.options).forEach((opt)=>{
      opt.selected = ids.has(opt.value);
    });
  }

  function renderDecisions(){
    decisionsBox.innerHTML = "";
    const ids = ensureArray(assignment?.approver_ids);
    if (!ids.length){
      const p = document.createElement("p");
      p.className = "approval-card__hint";
      p.textContent = "Добавьте согласующих, чтобы отслеживать решения.";
      decisionsBox.appendChild(p);
      return;
    }

    const map = new Map();
    decisions.forEach((item)=>{
      map.set(item.approver_id, item);
    });

    ids.forEach((id)=>{
      const decision = map.get(id) || { decision: "pending" };
      const row = document.createElement("div");
      row.className = "approval-decision";
      const head = document.createElement("div");
      head.className = "approval-decision__head";
      const nameEl = document.createElement("div");
      nameEl.className = "approval-decision__name";
      const profile = profiles.find((p)=>p.id === id);
      nameEl.textContent = formatName(profile);

      const tag = document.createElement("span");
      const info = DECISION_LABELS[decision.decision || "pending"] || DECISION_LABELS.pending;
      tag.className = `approval-decision__tag ${info.css}`;
      tag.textContent = info.label;

      head.appendChild(nameEl);
      head.appendChild(tag);
      row.appendChild(head);

      if (decision.decided_at){
        const dt = document.createElement("div");
        dt.className = "approval-card__hint";
        dt.textContent = DATE_FMT.format(new Date(decision.decided_at));
        row.appendChild(dt);
      }
      if (decision.comment){
        const comment = document.createElement("div");
        comment.className = "approval-decision__comment";
        comment.textContent = decision.comment;
        row.appendChild(comment);
      }
      decisionsBox.appendChild(row);
    });
  }

  function renderActions(){
    const ids = ensureArray(assignment?.approver_ids);
    const myIsApprover = ids.includes(currentUserId);
    const currentStatus = assignment?.status || initialStatus || "draft";
    const isPending = currentStatus === "draft" || currentStatus === "in_review";
    const myDecision = decisions.find((item)=> item.approver_id === currentUserId);
    if (myIsApprover && isPending && currentStatus !== "rejected" && currentStatus !== "finalized"){
      actionsSection.hidden = false;
      const approveBtn = actionsSection.querySelector('[data-approval-action="approve"]');
      const rejectBtn = actionsSection.querySelector('[data-approval-action="reject"]');
      approveBtn.disabled = myDecision?.decision === "approved";
      rejectBtn.disabled = myDecision?.decision === "rejected";
    }else{
      actionsSection.hidden = true;
    }

    if (canFinalize && currentStatus === "approved"){
      finalizeSection.hidden = false;
    }else{
      finalizeSection.hidden = true;
    }
  }

  async function ensureAssignment(){
    if (assignment) return assignment;
    const { data, error } = await supabase
      .from("document_approval_assignments")
      .select("*")
      .eq("document_type", documentType)
      .eq("document_id", documentId)
      .maybeSingle();
    if (error) throw error;
    if (data){
      assignment = data;
    }else{
      const payload = {
        document_type: documentType,
        document_id: documentId,
        status: initialStatus || "draft",
        document_title: documentTitle || null,
        document_number: documentNumber || null,
        document_url: documentUrl || null,
        metadata
      };
      const { data: inserted, error: insertError } = await supabase
        .from("document_approval_assignments")
        .insert(payload)
        .select("*")
        .single();
      if (insertError) throw insertError;
      assignment = inserted;
    }
    return assignment;
  }

  async function loadProfiles(){
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, login")
      .order("full_name", { ascending: true })
      .limit(500);
    if (error) throw error;
    profiles = data || [];
  }

  async function loadDecisions(){
    const { data, error } = await supabase
      .from("document_approvals")
      .select("id, approver_id, decision, comment, decided_at, assignment_id, approver:approver_id (full_name, login)")
      .eq("document_type", documentType)
      .eq("document_id", documentId);
    if (error) throw error;
    decisions = (data || []).map((row)=>({
      id: row.id,
      approver_id: row.approver_id,
      decision: row.decision,
      comment: row.comment,
      decided_at: row.decided_at,
      assignment_id: row.assignment_id,
      profile: row.approver
    }));
  }

  async function updateAssignment(payload){
    const update = {
      ...payload,
      document_title: documentTitle || assignment?.document_title || null,
      document_number: documentNumber || assignment?.document_number || null,
      document_url: documentUrl || assignment?.document_url || null,
      metadata: metadata ?? assignment?.metadata ?? null
    };
    const { data, error } = await supabase
      .from("document_approval_assignments")
      .update(update)
      .eq("id", assignment.id)
      .select("*")
      .single();
    if (error) throw error;
    assignment = data;
    return assignment;
  }

  async function updateStatus(nextStatus, opts = {}){
    const prev = assignment?.status || initialStatus || "draft";
    if (prev === nextStatus && !opts.force) return;
    await onStatusChange(nextStatus, prev);
    await updateAssignment({ status: nextStatus });
    await supabase
      .from("document_status_history")
      .insert({
        document_type: documentType,
        document_id: documentId,
        previous_status: prev,
        next_status: nextStatus,
        changed_by: currentUserId,
        comment: opts.comment || null
      });
  }

  async function saveApprovers(){
    if (!canEditApprovers) return;
    const current = Array.isArray(assignment?.approver_ids)
      ? assignment.approver_ids.map((id)=> id && id.toString ? id.toString() : String(id))
      : [];
    const selected = Array.from(selectEl?.selectedOptions || [])
      .map((opt)=> opt.value)
      .filter(Boolean);
    const unique = uniqueIds([...current, ...selected]);

    const nameMap = new Map();
    if (Array.isArray(assignment?.approver_ids) && Array.isArray(assignment?.approver_names)){
      assignment.approver_ids.forEach((id, idx)=>{
        const key = id && id.toString ? id.toString() : String(id);
        if (!nameMap.has(key) && assignment.approver_names[idx]){
          nameMap.set(key, assignment.approver_names[idx]);
        }
      });
    }

    const names = unique.map((id)=>{
      const prof = profiles.find((p)=> p.id === id);
      const resolved = formatName(prof);
      if (resolved && resolved.trim && resolved.trim()){
        return resolved;
      }
      return nameMap.get(id) || resolved || "Сотрудник";
    });
    const reopening = assignment?.status === "approved" || assignment?.status === "finalized";
    await updateAssignment({ approver_ids: unique, approver_names: names });
    renderChips();
    updateSelectFromAssignment();
    renderActions();
    const computed = calcNextStatus(assignment, decisions);
    if (reopening){
      await updateStatus("in_review", { force: true });
    }else{
      await updateStatus(computed);
    }
    applyStatus(assignment.status);
    await refresh();
    return;
  }

  async function resetApprovers(){
    if (!canEditApprovers) return;
    await updateAssignment({ approver_ids: [], approver_names: [] });
    renderChips();
    updateSelectFromAssignment();
    renderActions();
    await updateStatus("draft");
    applyStatus(assignment.status);
    await refresh();
    return;
  }

  function openDialog(action){
    dialog.dataset.action = action;
    dialogTitle.textContent = action === "approve" ? "Комментарий (необязательно)" : "Комментарий обязателен";
    dialogTip.textContent = action === "approve"
      ? "Вы можете оставить комментарий для автора документа."
      : "Укажите причину отклонения документа.";
    dialogTextarea.value = "";
    dialogError.hidden = true;
    dialog.hidden = false;
    dialogTextarea.focus();
  }

  function closeDialog(){
    dialog.hidden = true;
    dialog.dataset.action = "";
    dialogTextarea.value = "";
    dialogError.hidden = true;
  }

  async function submitDecision(action){
    const comment = dialogTextarea.value.trim();
    if (action === "reject" && !comment){
      dialogError.textContent = "Комментарий обязателен при отклонении.";
      dialogError.hidden = false;
      return;
    }
    try{
      const payload = {
        assignment_id: assignment?.id || null,
        document_type: documentType,
        document_id: documentId,
        approver_id: currentUserId,
        decision: action === "approve" ? "approved" : "rejected",
        comment: comment || null
      };
      const { error } = await supabase
        .from("document_approvals")
        .upsert(payload, { onConflict: "document_type,document_id,approver_id" });
      if (error) throw error;
      closeDialog();
      await reloadData();
      const next = calcNextStatus(assignment, decisions);
      await updateStatus(next, { comment: comment || null });
      applyStatus(assignment.status);
      renderDecisions();
      renderActions();
    }catch(e){
      dialogError.textContent = e.message || "Не удалось сохранить решение.";
      dialogError.hidden = false;
    }
  }

  async function reloadData(){
    await ensureAssignment();
    await loadDecisions();
  }

  async function initSelect(){
    if (!selectEl) return;
    selectEl.innerHTML = "";
    profiles.forEach((prof)=>{
      if (!prof?.id || prof.id === currentUserId) return;
      const option = document.createElement("option");
      option.value = prof.id;
      option.textContent = formatName(prof);
      selectEl.appendChild(option);
    });
    updateSelectFromAssignment();
  }

  async function initialize(){
    await ensureAssignment();
    await loadProfiles();
    await loadDecisions();
    applyStatus(assignment.status || initialStatus || "draft");
    renderChips();
    renderDecisions();
    renderActions();
    await initSelect();
    const computed = calcNextStatus(assignment, decisions);
    if (computed !== assignment.status && assignment.status !== "finalized"){
      await updateStatus(computed, { force: true });
      applyStatus(assignment.status);
    }
  }

  // Event bindings
  if (canEditApprovers){
    saveBtn?.addEventListener("click", async ()=>{
      saveBtn.disabled = true;
      try{
        await saveApprovers();
      }catch(e){
        alert(e.message || "Не удалось сохранить согласующих.");
      }finally{
        saveBtn.disabled = false;
      }
    });
    resetBtn?.addEventListener("click", async ()=>{
      if (!confirm("Очистить список согласующих?")) return;
      resetBtn.disabled = true;
      try{
        await resetApprovers();
      }catch(e){
        alert(e.message || "Не удалось сбросить согласующих.");
      }finally{
        resetBtn.disabled = false;
      }
    });
  }

  actionsSection?.querySelectorAll("[data-approval-action]").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const action = btn.dataset.approvalAction;
      openDialog(action);
    });
  });

  dialogCancel?.addEventListener("click", closeDialog);
  dialog?.addEventListener("click", (event)=>{
    if (event.target === dialog){
      closeDialog();
    }
  });
  dialogSave?.addEventListener("click", async ()=>{
    const action = dialog.dataset.action;
    if (!action) return;
    dialogSave.disabled = true;
    try{
      await submitDecision(action);
    }finally{
      dialogSave.disabled = false;
    }
  });

  finalizeBtn?.addEventListener("click", async ()=>{
    if (!confirm("Подтвердите, что загружена финальная версия документа и его можно отметить как оформленный.")) return;
    finalizeBtn.disabled = true;
    try{
      await onFinalize();
      await updateStatus("finalized");
      applyStatus(assignment.status);
      renderActions();
    }catch(e){
      alert(e.message || "Не удалось оформить документ.");
    }finally{
      finalizeBtn.disabled = false;
    }
  });

  await initialize();

  return {
    getAssignment: ()=> assignment,
    getDecisions: ()=> decisions,
    refresh: async ()=>{
      await reloadData();
      renderChips();
      renderDecisions();
      renderActions();
      applyStatus(assignment.status);
    }
  };
}
