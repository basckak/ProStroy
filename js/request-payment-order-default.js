import supabase, { requireSession } from "../supabaseClient.js";
import { createApprovalPicker } from "../approvalPicker.js";

const STORAGE_BUCKET = "contract-docs";
const TABLE_NAME = "payment_orders";
const headerReady = window.headerReady || Promise.resolve();

export async function init(){
  await headerReady;

  const okBox = document.getElementById("ok");
  const errBox = document.getElementById("err");
  const form = document.getElementById("paymentForm");
  const submitBtn = document.getElementById("submitBtn");
  const resetBtn = document.getElementById("resetBtn");
  const fileInput = document.getElementById("fileInput");
  const fileNameLabel = document.getElementById("fileName");
  const counterpartySelect = document.getElementById("counterpartyId");
  const counterpartyHint = document.getElementById("counterpartyHint");
  const objectSelect = document.getElementById("objectId");
  const objectsHint = document.getElementById("objectsHint");

  const approvalPicker = createApprovalPicker({
    supabase,
    wrapper: "approversSelect",
    display: "approversDisplay",
    search: "approversSearch",
    options: "approversOptions",
    help: "approversHelp"
  });

  function showOk(message){
    okBox.textContent = message;
    okBox.style.display = "block";
    errBox.style.display = "none";
  }

  function showErr(message){
    errBox.textContent = message;
    errBox.style.display = "block";
    okBox.style.display = "none";
  }

  function sanitizeFilename(name){
    return (name || "document")
      .replace(/[\\\s]+/g, "-")
      .replace(/[^0-9A-Za-zА-Яа-яЁё_.-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^(-|\.)+/, "")
      .slice(0, 120) || "document";
  }

  function parseAmount(value){
    const trimmed = (value || "").trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/\s+/g, "").replace(",", ".");
    const num = Number.parseFloat(normalized);
    return Number.isFinite(num) ? num : null;
  }

  async function loadCounterparties(){
    try{
      const { data, error } = await supabase
        .from("counterparties")
        .select("id, name, type")
        .order("name", { ascending: true });
      if (error) throw error;
      if (!data?.length){
        counterpartyHint.textContent = "Нет контрагентов. Добавьте их в разделе Контрагенты.";
        counterpartySelect.disabled = true;
        return;
      }
      const frag = document.createDocumentFragment();
      data.forEach(row => {
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = row.name || "Без названия";
        option.dataset.type = row.type || "";
        frag.appendChild(option);
      });
      counterpartySelect.appendChild(frag);
      counterpartySelect.disabled = false;
      counterpartyHint.textContent = "Выберите получателя платежа.";
    }catch(error){
      console.error("Не удалось загрузить контрагентов", error);
      counterpartyHint.textContent = "Ошибка загрузки контрагентов.";
      counterpartySelect.disabled = true;
    }
  }

  async function loadObjects(){
    try{
      const { data, error } = await supabase
        .from("objects")
        .select("id, title, status")
        .eq("status", "активен")
        .order("title", { ascending: true });
      if (error) throw error;
      if (!data?.length){
        objectsHint.textContent = "Нет активных объектов. Добавьте объект в разделе \"Объекты\".";
        objectSelect.disabled = true;
        return;
      }
      const frag = document.createDocumentFragment();
      data.forEach(row => {
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = row.title || "Без названия";
        frag.appendChild(option);
      });
      objectSelect.appendChild(frag);
      objectSelect.disabled = false;
      objectsHint.textContent = "При необходимости привяжите платёж к объекту.";
    }catch(error){
      console.error("Не удалось загрузить объекты", error);
      objectsHint.textContent = "Ошибка загрузки объектов.";
      objectSelect.disabled = true;
    }
  }

  fileInput?.addEventListener("change", ()=>{
    const file = fileInput.files?.[0];
    if (file){
      fileNameLabel.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} МБ)`;
      fileNameLabel.hidden = false;
    } else {
      fileNameLabel.hidden = true;
    }
  });

  resetBtn?.addEventListener("click", ()=>{
    form.reset();
    fileNameLabel.hidden = true;
    okBox.style.display = "none";
    errBox.style.display = "none";
    if (counterpartySelect.options.length) counterpartySelect.selectedIndex = 0;
    if (objectSelect.options.length) objectSelect.selectedIndex = 0;
    approvalPicker.reset();
  });

  let cachedSession = null;

  async function ensureSession(){
    if (cachedSession) return cachedSession;
    cachedSession = await requireSession();
    return cachedSession;
  }

  form?.addEventListener("submit", async (event)=>{
    event.preventDefault();
    okBox.style.display = "none";
    errBox.style.display = "none";

    const file = fileInput.files?.[0];
    if (!file){
      showErr("Прикрепите файл платёжного поручения.");
      return;
    }
    if (file.size > 20 * 1024 * 1024){
      showErr("Файл превышает 20 МБ.");
      return;
    }
    if (!counterpartySelect.value){
      showErr("Выберите получателя платежа.");
      return;
    }
    if (!document.getElementById("paymentType").value){
      showErr("Укажите тип платежа.");
      return;
    }
    const amountValue = parseAmount(document.getElementById("amount").value);
    if (amountValue === null){
      showErr("Проверьте сумму платежа. Используйте только цифры и разделитель . или ,");
      return;
    }

    let session;
    try{
      session = await ensureSession();
    }catch(authError){
      showErr(authError.message || "Необходимо авторизоваться.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Сохранение…";

    try{
      const recordId = crypto.randomUUID();
      const sanitizedName = sanitizeFilename(file.name);
      const storagePath = `${session.user.id}/${recordId}/${sanitizedName}`;

      const { error: uploadError } = await supabase
        .storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, {
          upsert: true,
          contentType: file.type || "application/octet-stream"
        });
      if (uploadError){
        throw uploadError;
      }

      const counterpartyOption = counterpartySelect.options[counterpartySelect.selectedIndex];
      const approverIds = approvalPicker.getSelectedIds();
      const approvalPayload = approverIds.length ? {
        approver_ids: approverIds,
        approver_names: approvalPicker.getSelectedNames()
      } : null;

      const payload = {
        id: recordId,
        order_number: document.getElementById("orderNumber").value.trim(),
        order_date: document.getElementById("orderDate").value || null,
        created_by: session.user.id,
        counterparty_id: counterpartySelect.value,
        counterparty_name: counterpartyOption?.textContent || null,
        counterparty_type: counterpartyOption?.dataset?.type || null,
        object_id: objectSelect.value || null,
        amount: amountValue,
        payment_type: document.getElementById("paymentType").value,
        purpose: document.getElementById("purpose").value.trim(),
        notes: document.getElementById("notes").value.trim() || null,
        file_path: storagePath,
        file_name: sanitizedName,
        file_type: file.type || null,
        file_size: file.size,
        approver_ids: approverIds,
        approval: approvalPayload,
        status: "draft"
      };

      const { error: insertError } = await supabase
        .from(TABLE_NAME)
        .insert(payload);
      if (insertError){
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(()=>{});
        throw insertError;
      }

      showOk("Платёжное поручение сохранено.");
      form.reset();
      fileNameLabel.hidden = true;
      if (counterpartySelect.options.length) counterpartySelect.selectedIndex = 0;
      if (objectSelect.options.length) objectSelect.selectedIndex = 0;
      approvalPicker.reset();
    }catch(error){
      console.error("Ошибка сохранения платёжного поручения", error);
      showErr(error.message || "Не удалось сохранить платёжное поручение.");
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = "Сохранить";
    }
  });

  try{
    cachedSession = await requireSession();
    await approvalPicker.loadDirectory();
  }catch(error){
    console.error("Не удалось инициализировать согласование", error);
  }

  await Promise.all([loadCounterparties(), loadObjects()]);

  supabase.auth.onAuthStateChange((_evt, session)=>{
    if (!session){
      location.replace("./index.html");
      return;
    }
    cachedSession = session;
    approvalPicker.loadDirectory().catch(error=>{
      console.error("Не удалось обновить список согласующих", error);
    });
  });
}
