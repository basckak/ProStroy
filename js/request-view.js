import supabase, { requireSession } from "../supabaseClient.js";
import { mountApprovalBlock } from "../approvalBlock.js";

const headerReady = window.headerReady || Promise.resolve();
const params = new URLSearchParams(location.search);
const requestId = params.get("id");

const byId = (id)=> document.getElementById(id);
const fmtDate = (value)=> value ? new Date(value).toLocaleDateString("ru-RU") : "—";
const fmtDateTime = (value)=> value ? new Date(value).toLocaleString("ru-RU") : "—";
const fmtNumber = (value, fractionDigits = 2)=>{
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("ru-RU", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
};
const setText = (id, value)=>{
  const el = byId(id);
  if (el) el.textContent = value;
};

let currentRequest = null;
let currentSession = null;

async function init(){
  await headerReady;
  currentSession = await requireSession({ redirectTo: "./index.html" });

  if (!requestId){
    alert("Не передан id заявки (?id=...)");
    location.replace("./requests-list.html");
    return;
  }

  await loadRequest().catch(error=>{
    console.error("[transport-view] loadRequest failed", error);
    alert(error.message || "Не удалось загрузить заявку.");
    location.replace("./profile.html");
  });

  document.addEventListener("approval-assignment-updated", handleExternalApprovalChange);
  document.addEventListener("approval-assignment-removed", handleExternalApprovalChange);
  document.addEventListener("document-approval-decision", handleDecisionEvent);

  supabase.auth.onAuthStateChange((_event, session)=> {
    if (!session){
      location.replace("./index.html");
    }
  });
}

async function loadRequest(){
  const { data, error } = await supabase
    .from("transport_requests")
    .select("id, request_no, user_id, destination, date_from, date_to, vehicle, vehicle_meta, cargo, loading_conditions, priority, requirements, route, safety, finance, billing_type, attachments, status, created_at, approval_id")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Заявка не найдена или нет доступа.");
  currentRequest = data;

  await populateRequest(data);
  await renderApprovalBlock(data);
  await loadHistory();
}

async function populateRequest(request){
  const number = request.request_no ? `Заявка ${request.request_no}` : "Заявка";
  setText("req-no", number);

  const statusEl = byId("req-status");
  if (statusEl){
    const normalized = (request.status || "").trim().toLowerCase();
    statusEl.classList.remove("status-approved","status-rejected","status-on_review","badge--double");
    if (normalized === "на согласовании"){
      statusEl.textContent = "На согласовании";
      statusEl.classList.add("status-on_review","badge--double");
    }else{
      statusEl.textContent = request.status || "—";
      if (normalized.includes("откл")){
        statusEl.classList.add("status-rejected");
      }else if (normalized.includes("одобр") || normalized.includes("соглас") || normalized.includes("на ознакомлении")){
        statusEl.classList.add("status-approved");
      }else{
        statusEl.classList.add("status-on_review");
      }
    }
  }

  setText("req-created", fmtDateTime(request.created_at));
  setText("kv-destination", request.destination || "—");
  setText("kv-dates", `${fmtDate(request.date_from)} — ${fmtDate(request.date_to)}`);

  const vehicleMeta = request.vehicle_meta || {};
  setText("kv-vehicle", request.vehicle || vehicleMeta.type || "—");
  setText("kv-loading", vehicleMeta.loading || "—");
  setText("kv-loading-conditions", request.loading_conditions || "—");
  setText("kv-priority", request.priority || "—");
  setText("kv-finance", request.finance != null ? `${fmtNumber(request.finance)} ₽` : "—");
  setText("kv-billing", request.billing_type || "—");
  setText("kv-route", request.route || "—");
  setText("kv-safety", request.safety || "—");

  renderAttachments(request.attachments);

  const cargo = request.cargo || {};
  setText("cg-name", cargo.name || "—");
  setText("cg-type", cargo.type || "—");
  setText("cg-hazard", cargo.hazard_class || "—");
  setText("cg-weight", cargo.weight_tonnes != null ? fmtNumber(cargo.weight_tonnes) : "—");
  setText("cg-volume", cargo.volume_m3 != null ? fmtNumber(cargo.volume_m3) : "—");
  setText("cg-packaging", cargo.packaging || "—");
  setText("cg-notes", cargo.notes || "—");

  const authorName = await resolveAuthorName(request.user_id);
  setText("req-author", authorName);
}

function renderAttachments(attachments){
  const container = byId("kv-attachments");
  if (!container) return;

  const text = attachments?.text?.trim() || "";
  const files = Array.isArray(attachments?.files) ? attachments.files : [];

  if (!text && files.length === 0){
    container.textContent = "—";
    return;
  }

  container.innerHTML = "";

  if (text){
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = text;
    container.appendChild(note);
  }

  if (files.length){
    const list = document.createElement("ul");
    list.className = "files-list";
    files.forEach(file=>{
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = file.public_url || "#";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = file.name || (file.path ? file.path.split("/").pop() : "файл");
      item.appendChild(link);

      const meta = [];
      if (file.mime) meta.push(file.mime);
      if (typeof file.size === "number") meta.push(`${Math.ceil(file.size / 1024)} KB`);
      if (meta.length){
        const span = document.createElement("span");
        span.className = "muted";
        span.textContent = ` (${meta.join(", ")})`;
        item.appendChild(span);
      }

      list.appendChild(item);
    });
    container.appendChild(list);
  }
}

async function resolveAuthorName(userId){
  if (!userId) return "Пользователь";
  try{
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, login")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return "Пользователь";
    return data.full_name?.trim() || data.login?.trim() || "Пользователь";
  }catch{
    return "Пользователь";
  }
}

async function renderApprovalBlock(request){
  const mountNode = byId("approval-block-mount");
  if (!mountNode) return;
  mountNode.textContent = "Загружаем согласование…";
  try{
    await mountApprovalBlock({
      mountId: "approval-block-mount",
      docKind: "transport_request",
      docId: request.id,
      title: request.destination || "Заявка на автотранспорт",
      documentNumber: request.request_no || null,
      approvalId: request.approval_id || null,
      documentType: "request_documents.transport_request",
      sourceTable: "transport_requests",
      onApprovalRemoved: async ()=>{
        await loadRequest().catch(error => {
          console.warn("[transport-view] reload after removal failed", error);
        });
      }
    });
  }catch(error){
    console.error("[transport-view] mountApprovalBlock failed", error);
    mountNode.innerHTML = `<div class="muted">Не удалось загрузить блок согласования.</div>`;
  }
}

async function loadHistory(){
  const box = byId("history");
  const historyCard = byId("historyCard");
  if (!box) return;

  box.innerHTML = '<div class="muted">Загружаем…</div>';

  try{
    const { data, error } = await supabase
      .from("transport_request_approvals")
      .select("approver_id, decision, comment, decided_at")
      .eq("request_id", requestId)
      .order("decided_at", { ascending: false });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length){
      box.innerHTML = `<div class="muted">Пока нет решений.</div>`;
      historyCard?.classList.add("is-empty");
      return;
    }

    const ids = [...new Set(rows.map(row => row.approver_id).filter(Boolean))];
    let profiles = new Map();
    if (ids.length){
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, login")
        .in("id", ids);
      profiles = new Map((profs || []).map(profile => [profile.id, profile]));
    }

    box.innerHTML = "";
    rows.forEach(row=>{
      const profile = profiles.get(row.approver_id);
      const name = profile?.full_name?.trim() || profile?.login?.trim() || "Сотрудник";
      const decision = row.decision === "approved"
        ? { label: "одобрил", cls: "status-approved" }
        : row.decision === "rejected"
          ? { label: "отклонил", cls: "status-rejected" }
          : { label: "ожидает", cls: "status-on_review" };

      const entry = document.createElement("div");
      entry.className = "history-entry";
      entry.innerHTML = `
        <div class="history-main">
          <span class="status-badge ${decision.cls}">${decision.label}</span>
          <strong>${name}</strong>
        </div>
        <div class="muted small">${fmtDateTime(row.decided_at)}</div>
      `;
      box.appendChild(entry);

      if (row.comment){
        const comment = document.createElement("div");
        comment.className = "history-comment";
        comment.textContent = row.comment;
        box.appendChild(comment);
      }
    });
    historyCard?.classList.remove("is-empty");
  }catch(error){
    console.error("[transport-view] loadHistory failed", error);
    box.innerHTML = `<div class="muted">Ошибка загрузки истории.</div>`;
    historyCard?.classList.remove("is-empty");
  }
}

function handleExternalApprovalChange(event){
  const targetId = event?.detail?.assignmentId || event?.detail?.approvalId || null;
  if (targetId && currentRequest?.approval_id && String(targetId) !== String(currentRequest.approval_id)){
    return;
  }

  loadRequest().catch(error => {
    console.warn("[transport-view] refresh after approval change failed", error);
  });
}

function handleDecisionEvent(event){
  const targetDocId = event?.detail?.documentId;
  if (targetDocId && String(targetDocId) !== String(requestId)){
    return;
  }
  loadRequest().catch(error => {
    console.warn("[transport-view] refresh after decision failed", error);
  });
}

document.addEventListener("click", event=>{
  const addButton = event.target.closest("[data-open-approver-modal]");
  if (addButton){
    event.preventDefault();
    if (currentRequest?.id){
      location.href = `./transport.html?id=${encodeURIComponent(currentRequest.id)}#approvals`;
    }
  }
});

init().catch(error=>{
  console.error("[transport-view] init failed", error);
  alert(error.message || "Ошибка инициализации.");
  location.replace("./profile.html");
});
