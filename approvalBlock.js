import supabase, { requireSession } from "./supabaseClient.js";

const STYLE_ID = "approval-block-styles";
const TOAST_ID = "approval-block-toast-root";

const STATUS_META = {
  pending: { label: "На согласовании", badge: "status-on_review" },
  approved: { label: "Согласовано", badge: "status-approved" },
  rejected: { label: "Отклонено", badge: "status-rejected" }
};

const ASSIGNMENT_STATUS_META = {
  draft: { label: "Черновик", badge: "status-draft" },
  in_review: { label: "На согласовании", badge: "status-on_review" },
  approved: { label: "Согласовано", badge: "status-approved" },
  rejected: { label: "Отклонено", badge: "status-rejected" },
  finalized: { label: "Оформлен", badge: "status-completed" }
};

const ROLE_LABELS = {
  admin: "Администратор",
  approver: "Согласующий",
  user: "Сотрудник"
};

function formatAddButtonLabel(count){
  if (!count) return "+ Добавить согласующего";
  if (count === 1) return "+ Добавить согласующего (1)";
  return `+ Добавить согласующего (${count})`;
}

function syncAddButtonLabel(count){
  const button = document.querySelector("[data-open-approver-modal]");
  if (button){
    button.textContent = formatAddButtonLabel(count);
  }
}

document.addEventListener("approval-picker-selection", (event)=>{
  const count = Number(event.detail?.count ?? 0);
  syncAddButtonLabel(count);
});

function ensureStyles(){
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  .approval-table-wrapper{width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;box-sizing:border-box;padding:0px ;margin:0 auto;}

  .appr-table{width:100%;min-width:950px;border-collapse:collapse;border-spacing:0;table-layout:fixed;background:rgba(15,23,42,0.76);}
  .appr-table thead{background:rgba(148,163,184,0.16);}
  .appr-table th,
  .appr-table td{padding:16px 18px;border-bottom:1px solid rgba(148,163,184,0.18);font-size:0.92rem;text-align:center;vertical-align:middle;white-space:normal;word-break:break-word;}
  .appr-table thead th{text-align:center;font-size:0.78rem;letter-spacing:0.09em;text-transform:uppercase;color:#e2e8f0;}
  .appr-table thead th:nth-child(1){width:16%;}
  .appr-table thead th:nth-child(2){width:20%;}
  .appr-table thead th:nth-child(3){width:23%;}
  .appr-table thead th:nth-child(4){width:30%;}
  .appr-table thead th:nth-child(5){width:18%;}
  .appr-cell-user{text-align:left;min-width:0;}
  .appr-status-cell .appr-status-wrap{display:flex;align-items:center;justify-content:center;gap:10px;min-height:80px;height:100%;}
  .appr-table tbody tr:last-child td{border-bottom:none;}
  .appr-table tbody tr:nth-child(odd),
.appr-table tbody tr:nth-child(even) {
  background: transparent; /* или нужный тебе общий фон */
}
  .appr-table tbody tr:hover{background:rgba(34,197,94,0.08);}
  .appr-user-name{font-weight:600;font-size:0.96rem;}
  .appr-user-meta{margin-top:4px;font-size:0.82rem;color:var(--muted);}
  .appr-status-cell{text-align:center;padding:16px 18px;}
  .appr-status-wrap{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;min-height:80px;padding:0 6px;}
  .approval-status-line{display:inline-flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;min-height:36px;}
  .appr-status-comment{font-size:0.9rem;color:var(--muted);white-space:pre-wrap;}
  .appr-actions{width:170px;padding:16px 18px;text-align:center;}
  .appr-actions .appr-actions-wrap{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:10px;min-height:80px;height:100%;}
  .appr-actions .btn{width:100%;min-width:0;box-sizing:border-box;}
  .appr-comment-input{width:100%;min-height:112px;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,0.26);background:rgba(8,13,23,0.6);color:inherit;font:inherit;resize:vertical;box-sizing:border-box;}
  .appr-comment-input:focus{outline:2px solid rgba(191,223,255,0.35);outline-offset:1px;}
  .appr-comment-hint{margin-top:8px;font-size:0.82rem;color:var(--muted);}
  .appr-cell-user,.appr-cell-comment{vertical-align:top;min-width:0;}
  .appr-cell-comment textarea.appr-comment-input{width:100%;min-height: 70px;max-width:100%;box-sizing:border-box;}
  .appr-empty{padding:24px 20px;border-radius:14px;border:1px dashed rgba(148,163,184,0.32);background:rgba(15,23,42,0.6);font-size:0.92rem;color:var(--muted);text-align:center;}
  .appr-toast{position:fixed;bottom:32px;right:32px;min-width:220px;padding:14px 18px;border-radius:14px;background:rgba(9,15,26,0.88);color:#f4f7ff;box-shadow:0 12px 32px rgba(6,9,20,0.45);opacity:0;transform:translateY(12px);transition:opacity 0.2s ease,transform 0.2s ease;}
  .appr-toast.show{opacity:1;transform:translateY(0);}
  
  @media (max-width:900px){
    .appr-table thead{display:none;}
    .appr-table,.appr-table tbody,.appr-table tr,.appr-table td{display:block;width:100%;}
    .appr-table tr{margin-bottom:16px;border:1px solid rgba(148,163,184,0.2);border-radius:16px;overflow:hidden;}
    .appr-table td{border:0;padding:14px 16px;}
    .appr-table td::before{content:attr(data-label);display:block;font-size:0.75rem;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;margin-bottom:6px;}
    .appr-actions{justify-content:flex-start;}
  }
  @media (max-width:720px){.appr-toast{left:50%;right:auto;transform:translate(-50%,12px);}}
  `;
  document.head.appendChild(style);
}

function resolveMount(mountId){
  if (!mountId) return null;
  if (typeof mountId === "string") return document.getElementById(mountId);
  return mountId;
}

function formatUserName(profile){
  if (!profile) return "Сотрудник";
  const full = profile.full_name?.trim();
  if (full) return full;
  const login = profile.login?.trim();
  if (login) return login;
  return "Сотрудник";
}

function formatRoleValue(value){
  if (!value) return "";
  const key = String(value).trim().toLowerCase();
  return ROLE_LABELS[key] || String(value).trim();
}

function formatDateTime(value){
  if (!value) return "";
  try{
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }catch(_){
    return "";
  }
}

function renderError(mountNode, message){
  if (!mountNode) return;
  const box = document.createElement("div");
  box.className = "status-pane status-err is-visible";
  box.textContent = message || "Не удалось отобразить блок согласования.";
  mountNode.innerHTML = "";
  mountNode.appendChild(box);
}

function createEmptyState(){
  const wrap = document.createElement("div");
  wrap.className = "appr-empty";
  const title = document.createElement("strong");
  title.textContent = "Согласующие не назначены";
  const text = document.createElement("div");
  text.className = "muted";
  text.style.marginTop = "6px";
  text.textContent = "Нажмите «Добавить согласующего», чтобы выбрать участников.";
  wrap.append(title, text);
  return wrap;
}

function showToast(message){
  if (!message) return;
  let root = document.getElementById(TOAST_ID);
  if (!root){
    root = document.createElement("div");
    root.id = TOAST_ID;
    document.body.appendChild(root);
  }
  const toast = document.createElement("div");
  toast.className = "appr-toast";
  toast.textContent = message;
  root.appendChild(toast);
  requestAnimationFrame(()=> toast.classList.add("show"));
  setTimeout(()=>{
    toast.classList.remove("show");
    setTimeout(()=> toast.remove(), 220);
  }, 2400);
}

function safeText(value){
  return typeof value === "string" ? value.trim() : "";
}


async function postDecision({ assignmentId, docType, docId, decision, comment, userId, sourceTable }){
  if (!assignmentId){
    throw new Error("Не найдено активное согласование.");
  }
  const payload = {
    assignment_id: assignmentId,
    document_type: docType,
    document_id: docId,
    approver_id: userId,
    decision,
    comment: comment || null,
    decided_at: new Date().toISOString()
  };
  const { data: existingDecision, error: lookupError } = await supabase
    .from("document_approvals")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("approver_id", userId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existingDecision?.id){
    const { error: updateError } = await supabase
      .from("document_approvals")
      .update(payload)
      .eq("id", existingDecision.id);
    if (updateError) throw updateError;
  }else{
    const { error: insertError } = await supabase
      .from("document_approvals")
      .insert(payload);
    if (insertError) throw insertError;
  }

  const { data: assignmentRow, error: assignmentError } = await supabase
    .from("document_approval_assignments")
    .select("id, status, approver_ids")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentError) throw assignmentError;

  const approverIds = Array.isArray(assignmentRow?.approver_ids) ? assignmentRow.approver_ids : [];
  const decisionsQuery = supabase
    .from("document_approvals")
    .select("approver_id, decision")
    .eq("document_type", docType)
    .eq("document_id", docId);
  if (assignmentId){
    decisionsQuery.eq("assignment_id", assignmentId);
  }
  const { data: decisions, error: decisionsError } = await decisionsQuery;
  if (decisionsError) throw decisionsError;

  let nextStatus = "in_review";
  if (Array.isArray(decisions) && decisions.some(row => row.decision === "rejected")){
    nextStatus = "rejected";
  }else if (
    approverIds.length &&
    approverIds.every(id => decisions?.some(row => row.approver_id === id && row.decision === "approved"))
  ){
    nextStatus = "approved";
  }

  if (nextStatus !== assignmentRow?.status){
    await supabase
      .from("document_approval_assignments")
      .update({ status: nextStatus })
      .eq("id", assignmentId);
    if (sourceTable){
      const statusMap = {
        approved: "approved",
        rejected: "rejected",
        in_review: "in_review"
      };
      const docStatus = statusMap[nextStatus] || null;
      if (docStatus){
        try{
          await supabase
            .from(sourceTable)
            .update({ status: docStatus })
            .eq("id", docId);
        }catch(docUpdateError){
          console.warn("approvalBlock: document status update failed", docUpdateError);
        }
      }
    }
  }

  try{
    document.dispatchEvent(new CustomEvent("document-approval-decision", {
      detail: {
        assignmentId,
        documentId: docId,
        documentType: docType,
        status: nextStatus,
        approverId: userId,
        decision
      }
    }));
  }catch(eventError){
    console.warn("approvalBlock: dispatch decision event failed", eventError);
  }
}

async function removeAssignment({ assignmentId }){
  if (!assignmentId) return;

  const { error: approvalsError } = await supabase
    .from("document_approvals")
    .delete()
    .eq("assignment_id", assignmentId);
  if (approvalsError) throw approvalsError;

  const { error: assignmentError } = await supabase
    .from("document_approval_assignments")
    .delete()
    .eq("id", assignmentId);
  if (assignmentError) throw assignmentError;
}

function bindDecisionActions({ mountNode, userId, assignmentId, docType, docId, sourceTable, refresh }){
  const controls = mountNode.querySelectorAll("[data-approval-decision]");
  controls.forEach((btn)=>{
    btn.addEventListener("click", async (event)=>{
      event.preventDefault();
      const decision = btn.dataset.approvalDecision;
      const approverId = btn.dataset.approverId;
      if (!decision || !approverId) return;
      if (String(approverId) !== String(userId)) return;
      const rowNode = btn.closest("[data-approver-row]");
      const related = rowNode ? rowNode.querySelectorAll("[data-approval-decision]") : [];
      related.forEach(button => button.disabled = true);
      const commentInput = rowNode?.querySelector("textarea[data-approval-comment]");
      const comment = commentInput ? commentInput.value.trim() : "";
      try{
        await postDecision({
          assignmentId,
          docType,
          docId,
          decision,
          comment,
          userId,
          sourceTable
        });
        showToast("Решение сохранено.");
        await refresh();
      }catch(error){
        console.error("approvalBlock: decision failed", error);
        showToast(error?.message || "Не удалось сохранить решение.");
      }finally{
        related.forEach(button => button.disabled = false);
      }
    }, { once: false });
  });
}

function bindHeaderActions({
  mountNode,
  assignmentId,
  docType,
  docId,
  sourceTable,
  onApprovalRemoved,
  setAssignmentId
}){
  const removeButton = mountNode.querySelector("[data-remove-approval]");
  if (!removeButton) return;

  removeButton.addEventListener("click", async event => {
    event.preventDefault();
    if (!assignmentId) return;
    const confirmed = window.confirm("Удалить лист согласования? Это действие нельзя отменить.");
    if (!confirmed) return;

    removeButton.disabled = true;
    try{
      await removeAssignment({ assignmentId });
      setAssignmentId?.(null);
      document.dispatchEvent(new CustomEvent("approval-assignment-removed", {
        detail: {
          assignmentId,
          documentId: docId || null,
          documentType: docType || null,
          sourceTable: sourceTable || null
        }
      }));
      syncAddButtonLabel(0);
      showToast("Согласование удалено.");
      const hasCallback = typeof onApprovalRemoved === "function";
      let callbackFailed = false;
      if (hasCallback){
        try{
          await onApprovalRemoved({ assignmentId, docType, docId, sourceTable });
        }catch(callbackError){
          console.warn("[approvalBlock] onApprovalRemoved callback failed", callbackError);
          callbackFailed = true;
        }
      }
      if (!hasCallback || callbackFailed){
        mountNode.innerHTML = '<div class="muted">Согласование удалено. Добавьте новый блок, чтобы продолжить.</div>';
      }
    }catch(error){
      console.error("[approvalBlock] delete assignment failed", error);
      showToast(error?.message || "Не удалось удалить согласование.");
      removeButton.disabled = false;
    }
  });
}

function renderApprovalUI({
  mountNode,
  user,
  assignmentId,
  docType,
  docId,
  sourceTable,
  assignees,
  assignment,
  refresh,
  onApprovalRemoved,
  setAssignmentId
}){
  mountNode.innerHTML = "";

  const header = document.createElement("div");
  header.className = "approval-card__header";

  const headerInfo = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "approval-card__title";
  title.textContent = "Лист согласования";
  headerInfo.appendChild(title);

  const statusMeta = ASSIGNMENT_STATUS_META[assignment?.status] || ASSIGNMENT_STATUS_META.in_review;
  const statusLine = document.createElement("div");
  statusLine.className = "approval-card__meta";
  const statusLabel = document.createElement("span");
  statusLabel.textContent = "Текущий статус согласования:";
  const statusBadge = document.createElement("span");
  statusBadge.className = `status-badge ${statusMeta.badge || "status-other"}`;
  const statusLabelText = statusMeta.label || "";
  statusBadge.textContent = statusLabelText;
  if (statusLabelText.trim().toLowerCase() === "на согласовании"){
    statusBadge.classList.add("badge--double");
  }
  statusLine.append(statusLabel, statusBadge);
  headerInfo.appendChild(statusLine);

  const headerActions = document.createElement("div");
  headerActions.className = "approval-card__actions";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn action";
  addButton.textContent = formatAddButtonLabel(Array.isArray(assignees) ? assignees.length : 0);
  addButton.dataset.openApproverModal = "true";
  headerActions.appendChild(addButton);

  if (assignmentId){
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn-ghost";
    removeButton.textContent = "Удалить согласование";
    removeButton.dataset.removeApproval = "true";
    headerActions.appendChild(removeButton);
  }

  header.append(headerInfo, headerActions);
  mountNode.appendChild(header);

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "approval-table-wrapper";

  if (!Array.isArray(assignees) || !assignees.length){
    syncAddButtonLabel(0);
    if (typeof onAssigneesLoaded === "function"){
      try{
        onAssigneesLoaded({ ids: [], rows: [], assignment: assignment || null });
      }catch(callbackError){
        console.warn("[approvalBlock] onAssigneesLoaded callback failed", callbackError);
      }
    }
    tableWrapper.appendChild(createEmptyState());
    mountNode.appendChild(tableWrapper);
    return;
  }

  const table = document.createElement("table");
  table.className = "appr-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Дата добавления", "Пользователь", "Текущий статус", "Комментарий", "Действия"].forEach(label => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  const currentUserId = user?.id != null ? String(user.id) : "";

  assignees.forEach(row => {
    const approverId = row.assignee_id || row.approver_id || row.id;
    const approverIdStr = approverId != null ? String(approverId) : "";
    const isMine = approverIdStr && approverIdStr === currentUserId;
    const tr = document.createElement("tr");
    tr.dataset.approverRow = "true";
    if (approverIdStr){
      tr.dataset.assigneeId = approverIdStr;
    }
    tr.dataset.status = row.status || "pending";

    const addedCell = document.createElement("td");
    addedCell.dataset.label = "Дата добавления";
    addedCell.className = "appr-cell-date";
    const addedWrap = document.createElement("div");
    addedWrap.className = "appr-cell-inner";
    const addedDate = document.createElement("div");
    addedDate.textContent = formatDateTime(row.added_at) || "—";
    addedWrap.appendChild(addedDate);
    if (row.adder){
      const addedBy = document.createElement("div");
      addedBy.className = "appr-user-meta";
      addedBy.textContent = `Добавил: ${formatUserName(row.adder)}`;
      addedWrap.appendChild(addedBy);
    }
    addedCell.appendChild(addedWrap);
    tr.appendChild(addedCell);

    const userCell = document.createElement("td");
    userCell.dataset.label = "Пользователь";
    userCell.className = "appr-cell-user";
    const userWrap = document.createElement("div");
    userWrap.className = "appr-cell-inner";
    const userName = document.createElement("div");
    userName.className = "appr-user-name";
    userName.textContent = formatUserName(row.assignee);
    userWrap.appendChild(userName);
    const roleLabel = formatRoleValue(row.role || row.assignee?.role || "");
    if (roleLabel){
      const roleMeta = document.createElement("div");
      roleMeta.className = "appr-user-meta";
      roleMeta.textContent = roleLabel;
      userWrap.appendChild(roleMeta);
    }
    userCell.appendChild(userWrap);
    tr.appendChild(userCell);

    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Текущий статус";
    statusCell.className = "appr-status-cell";
    const statusWrap = document.createElement("div");
    statusWrap.className = "appr-cell-inner";
    const meta = STATUS_META[row.status] || { label: row.status || "Статус", badge: "status-other" };
    const statusLineEl = document.createElement("div");
    statusLineEl.className = "approval-status-line";
    const badge = document.createElement("span");
    badge.className = `status-badge ${meta.badge || "status-other"}`;
    const badgeRaw = meta.label || "Статус";
    badge.textContent = badgeRaw;
    if (badgeRaw.trim().toLowerCase() === "на согласовании"){
      badge.classList.add("badge--double");
    }
    statusLineEl.appendChild(badge);
    statusWrap.appendChild(statusLineEl);
    if (row.decided_at){
      const decided = document.createElement("div");
      decided.className = "appr-user-meta";
      decided.textContent = `Решение: ${formatDateTime(row.decided_at)}`;
      statusWrap.appendChild(decided);
    }
    statusCell.appendChild(statusWrap);
    tr.appendChild(statusCell);

    const commentCell = document.createElement("td");
    commentCell.dataset.label = "Комментарий";
    commentCell.className = "appr-cell-comment";
    const commentWrap = document.createElement("div");
    commentWrap.className = "appr-cell-inner";
    if (isMine && row.status === "pending"){
      const textarea = document.createElement("textarea");
      textarea.className = "appr-comment-input";
      textarea.value = safeText(row.comment);
      textarea.dataset.approvalComment = "true";
      commentWrap.appendChild(textarea);

      const hint = document.createElement("div");
      hint.className = "appr-comment-hint";
      commentWrap.appendChild(hint);
    }else{
      const commentText = document.createElement("div");
      commentText.className = "appr-status-comment";
      const commentValue = safeText(row.comment);
      commentText.textContent = commentValue || "Комментариев нет.";
      commentWrap.appendChild(commentText);
    }
    commentCell.appendChild(commentWrap);
    tr.appendChild(commentCell);

    const actionsCell = document.createElement("td");
    actionsCell.dataset.label = "Действия";
    actionsCell.className = "appr-actions";
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "appr-cell-inner appr-actions-wrap";
    if (isMine && row.status === "pending"){
      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "btn btn-primary";
      approveBtn.textContent = "Согласовать";
      approveBtn.dataset.approvalDecision = "approved";
      approveBtn.dataset.approverId = approverIdStr;

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "btn btn-ghost";
      rejectBtn.textContent = "Отклонить";
      rejectBtn.dataset.approvalDecision = "rejected";
      rejectBtn.dataset.approverId = approverIdStr;

      actionsWrap.append(approveBtn, rejectBtn);
    }else{
      const decisionInfo = document.createElement("div");
      decisionInfo.className = "appr-user-meta";
      decisionInfo.textContent = row.decided_at
        ? `Решение: ${formatDateTime(row.decided_at)}`
        : "Решение: —";
      actionsWrap.appendChild(decisionInfo);
    }
    actionsCell.appendChild(actionsWrap);
    tr.appendChild(actionsCell);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  mountNode.appendChild(tableWrapper);
  syncAddButtonLabel(Array.isArray(assignees) ? assignees.length : 0);

  bindDecisionActions({
    mountNode,
    userId: user.id,
    assignmentId,
    docType,
    docId,
    sourceTable,
    refresh
  });

  bindHeaderActions({
    mountNode,
    assignmentId,
    docType,
    docId,
    sourceTable,
    onApprovalRemoved,
    setAssignmentId
  });
}

export async function mountApprovalBlock({
  mountId,
  docKind,
  docId,
  title,
  objectId = null,
  approvalId = null,
  documentType,
  documentNumber = null,
  sourceTable = null,
  onApprovalCreated,
  onAssigneesLoaded,
  onApprovalRemoved
} = {}){
  ensureStyles();
  const mountNode = resolveMount(mountId);
  if (!mountNode){
    console.warn("[approvalBlock] mount node not found", mountId);
    return;
  }
  mountNode.innerHTML = '<div class="muted">Загружаем согласование…</div>';

  let session;
  try{
    session = await requireSession();
  }catch(error){
    console.error("[approvalBlock] auth required", error);
    renderError(mountNode, "Необходимо авторизоваться для просмотра согласования.");
    return;
  }

  const user = session.user;
  const docType = documentType || (docKind ? `request_documents.${docKind}` : "request_documents");
  let assignmentId = approvalId || null;

  async function fetchAssignmentById(id){
    if (!id) return null;
    const { data, error } = await supabase
      .from("document_approval_assignments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error){
      console.warn("[approvalBlock] assignment fetch failed", error);
      return null;
    }
    return data || null;
  }

  async function fetchAssignmentByDocument(){
    const { data, error } = await supabase
      .from("document_approval_assignments")
      .select("*")
      .eq("document_type", docType)
      .eq("document_id", docId)
      .maybeSingle();
    if (error){
      console.warn("[approvalBlock] assignment fetch by document failed", error);
      return null;
    }
    return data || null;
  }

  async function createAssignment(){
    const payload = {
      document_type: docType,
      document_id: docId,
      status: "in_review",
      document_title: title || null,
      document_number: documentNumber || null,
      document_url: null,
      approver_ids: [],
      approver_names: [],
      created_by: user.id
    };
    const { data, error } = await supabase
      .from("document_approval_assignments")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  let assignment = await fetchAssignmentById(assignmentId);
  if (!assignment){
    assignment = await fetchAssignmentByDocument();
  }
  if (!assignment){
    try{
      assignment = await createAssignment();
      assignmentId = assignment?.id || null;
      if (assignmentId && typeof onApprovalCreated === "function"){
        await onApprovalCreated(assignmentId);
        const refreshed = await fetchAssignmentById(assignmentId);
        if (refreshed) assignment = refreshed;
      }
    }catch(createError){
      console.error("[approvalBlock] create assignment failed", createError);
      renderError(mountNode, "Ошибка создания согласования.");
      return;
    }
  }else if (!assignmentId && assignment?.id){
    assignmentId = assignment.id;
  }

  if (!assignment || !assignmentId){
    renderError(mountNode, "Не удалось подготовить согласование.");
    return;
  }

  const metadataPatch = {};
  if (title && assignment.document_title !== title){
    metadataPatch.document_title = title;
  }
  if (documentNumber && assignment.document_number !== documentNumber){
    metadataPatch.document_number = documentNumber;
  }
  if (Object.keys(metadataPatch).length){
    try{
      const { data: updated } = await supabase
        .from("document_approval_assignments")
        .update(metadataPatch)
        .eq("id", assignmentId)
        .select("*")
        .single();
      if (updated) assignment = updated;
    }catch(updateError){
      console.warn("[approvalBlock] assignment metadata update failed", updateError);
    }
  }

  async function loadAssignees(){
    const { data: assignmentRow, error: assignmentLoadError } = await supabase
      .from("document_approval_assignments")
      .select("*")
      .eq("id", assignmentId)
      .maybeSingle();
    if (assignmentLoadError) throw assignmentLoadError;
    if (!assignmentRow){
      assignment = null;
      return { rows: [], assignmentRow: null };
    }
    assignment = assignmentRow;
    const ids = Array.isArray(assignmentRow.approver_ids) ? assignmentRow.approver_ids.slice() : [];
    const rows = [];
    if (!ids.length){
      return { rows, assignmentRow };
    }

    const profileIds = new Set(ids);
    if (assignmentRow.created_by){
      profileIds.add(assignmentRow.created_by);
    }

    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, login, role")
      .in("id", Array.from(profileIds));
    if (profilesError) throw profilesError;
    const profileMap = new Map();
    (profilesData || []).forEach(profile => profileMap.set(profile.id, profile));

    const adderProfile = assignmentRow.created_by ? profileMap.get(assignmentRow.created_by) || null : null;

    const decisionsQuery = supabase
      .from("document_approvals")
      .select("id, approver_id, decision, comment, decided_at, assignment_id")
      .eq("document_type", docType)
      .eq("document_id", docId);
    if (assignmentId){
      decisionsQuery.eq("assignment_id", assignmentId);
    }
    const { data: decisionsData, error: decisionsError } = await decisionsQuery;
    if (decisionsError) throw decisionsError;
    const decisionMap = new Map();
    (decisionsData || []).forEach(row => decisionMap.set(row.approver_id, row));

    ids.forEach((approverId, index)=>{
      const decision = decisionMap.get(approverId);
      const profile = profileMap.get(approverId) || null;
      rows.push({
        id: decision?.id || `${assignmentId}:${approverId}:${index}`,
        approval_id: assignmentId,
        assignee_id: approverId,
        status: decision?.decision || "pending",
        comment: decision?.comment || "",
        decided_at: decision?.decided_at || null,
        assignee: profile,
        adder: adderProfile,
        added_at: assignmentRow.created_at || null,
        role: profile?.role || null
      });
    });

    if (typeof onAssigneesLoaded === "function"){
      try{
        onAssigneesLoaded({ ids, rows, assignment: assignmentRow });
      }catch(callbackError){
        console.warn("[approvalBlock] onAssigneesLoaded callback failed", callbackError);
      }
    }

    return { rows, assignmentRow };
  }

  const refresh = async ()=>{
    mountNode.innerHTML = '<div class="muted">Обновляем согласование…</div>';
    try{
      const { rows, assignmentRow } = await loadAssignees();
      if (assignmentRow?.id && assignmentId !== assignmentRow.id){
        assignmentId = assignmentRow.id;
      }else if (!assignmentRow){
        assignmentId = null;
      }
      renderApprovalUI({
        mountNode,
        user,
        assignmentId,
        docType,
        docId,
        sourceTable,
        assignees: rows,
        assignment: assignmentRow,
        refresh,
        onApprovalRemoved,
        setAssignmentId: value => {
          assignmentId = value;
        }
      });
    }catch(error){
      console.error("[approvalBlock] load failed", error);
      renderError(mountNode, "Ошибка загрузки согласования.");
    }
  };

  if (typeof mountNode.__approvalCleanup === "function"){
    try{
      mountNode.__approvalCleanup();
    }catch(cleanupError){
      console.warn("[approvalBlock] previous cleanup failed", cleanupError);
    }
  }

  const externalUpdateHandler = (event)=>{
    const target = event?.detail?.assignmentId || event?.detail?.approvalId || null;
    if (target && String(target) !== String(assignmentId)) return;
    if (Array.isArray(event?.detail?.approverIds)){
      syncAddButtonLabel(event.detail.approverIds.length);
    }
    refresh().catch(err => console.warn("[approvalBlock] external refresh failed", err));
  };

  document.addEventListener("approval-assignment-updated", externalUpdateHandler);
  mountNode.__approvalCleanup = ()=>{
    document.removeEventListener("approval-assignment-updated", externalUpdateHandler);
  };
  mountNode.__approvalRefresh = refresh;

  await refresh();
}
