import supabaseDefault from "./supabaseClient.js";

const ROLE_LABELS = {
  admin: "Администратор",
  approver: "Согласующий",
  user: "Сотрудник"
};

function resolveNodes(ref){
  if (!ref) return null;
  if (typeof ref === "string") return document.getElementById(ref);
  return ref;
}

export function createApprovalPicker({
  supabase = supabaseDefault,
  wrapper,
  display,
  search,
  options,
  help
} = {}){
  const wrapperNode = resolveNodes(wrapper) || document.getElementById("approversSelect");
  const selectedNode = resolveNodes(display) || document.getElementById("approversDisplay");
  const searchNode = resolveNodes(search) || document.getElementById("approversSearch");
  const optionsNode = resolveNodes(options) || document.getElementById("approversOptions");
  const helpNode = resolveNodes(help) || document.getElementById("approversHelp");

  const missing = [];
  if (!wrapperNode) missing.push("wrapper");
  if (!optionsNode) missing.push("options");
  if (missing.length){
    console.warn(`approvalPicker: отсутствуют необходимые элементы (${missing.join(", ")})`);
  }

  const changeHandlers = new Set();

  const state = {
    list: [],
    map: new Map(),
    selected: new Set(),
    loading: true,
    error: null,
    pendingSelection: new Set(),
    query: "",
    outsideBound: false
  };

  function notifyChange(){
    const entries = Array.from(state.selected).map(id => {
      const info = state.map.get(id);
      return {
        id,
        name: info?.displayName || "Сотрудник",
        displayName: info?.displayName || "Сотрудник",
        meta: info?.meta || "",
        role: info?.role || "",
        login: info?.login || ""
      };
    });
    document.dispatchEvent(new CustomEvent("approval-picker-selection", {
      detail: { count: entries.length }
    }));
    changeHandlers.forEach(handler=>{
      try{
        handler(entries);
      }catch(error){
        console.error("approvalPicker: onChange handler failed", error);
      }
    });
  }

  function getSelectedNames(){
    return Array.from(state.selected).map(id => state.map.get(id)?.displayName || "Сотрудник");
  }

  function applyOptionState(option, isSelected){
    if (!option) return;
    option.classList.toggle("is-checked", isSelected);
    option.setAttribute("aria-checked", isSelected ? "true" : "false");
  }

  function findOption(id){
    if (!optionsNode) return null;
    const safeId = (window.CSS && typeof CSS.escape === "function") ? CSS.escape(id) : id;
    return optionsNode.querySelector(`[data-user-id="${safeId}"]`);
  }

  function updateHelp(){
    if (!helpNode) return;
    if (state.loading){
      helpNode.textContent = "Загружаем сотрудников…";
      return;
    }
    if (state.error){
      helpNode.textContent = state.error;
      return;
    }
    const count = state.selected.size;
    helpNode.textContent = count ? `Выбрано согласующих: ${count}` : "Начните вводить фамилию, должность или email.";
  }

  function renderSelected(){
    if (!selectedNode) return;
    selectedNode.innerHTML = "";
    selectedNode.classList.add("empty");

    if (state.loading){
      selectedNode.textContent = "Загружаем сотрудников…";
      return;
    }
    if (state.error){
      selectedNode.textContent = state.error;
      return;
    }
    if (!state.selected.size){
      selectedNode.textContent = "Согласующие не выбраны.";
      return;
    }

    selectedNode.classList.remove("empty");
    const fragment = document.createDocumentFragment();
    const summary = document.createElement("div");
    summary.className = "multi-summary";
    const count = state.selected.size;
    summary.textContent = count === 1 ? "Выбран 1 согласующий" : `Выбрано согласующих: ${count}`;
    fragment.appendChild(summary);

    state.selected.forEach(id => {
      const info = state.map.get(id);
      if (!info) return;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "tag";
      card.dataset.userId = id;

      const primary = document.createElement("span");
      primary.className = "tag__primary";
      primary.textContent = info.displayName || info.name || "Сотрудник";
      card.appendChild(primary);

      const metaParts = [];
      if (info.role) metaParts.push(info.role);
      if (info.login) metaParts.push(`@${info.login}`);
      if (info.email) metaParts.push(info.email);
      if (!metaParts.length && info.meta){
        metaParts.push(info.meta);
      }
      if (metaParts.length){
        const meta = document.createElement("span");
        meta.className = "tag__meta";
        meta.textContent = metaParts.join(" · ");
        card.appendChild(meta);
      }

      card.addEventListener("click", event => {
        event.preventDefault();
        state.selected.delete(id);
        const option = findOption(id);
        if (option) applyOptionState(option, false);
        renderSelected();
        updateHelp();
        notifyChange();
      });

      fragment.appendChild(card);
    });

    selectedNode.appendChild(fragment);
  }

  function clearSearch(){
    if (!searchNode) return;
    if (searchNode.value){
      searchNode.value = "";
    }
    if (state.query){
      state.query = "";
      renderOptions();
    }
  }

  function clearQuery(){
    state.query = "";
    if (searchNode){
      searchNode.value = "";
    }
    renderOptions();
  }

  function buildOption(user){
    const option = document.createElement("button");
    option.type = "button";
    option.className = "multi-option";
    option.dataset.userId = user.id;
    option.setAttribute("role", "checkbox");

    const check = document.createElement("span");
    check.className = "multi-check";
    check.setAttribute("aria-hidden", "true");

    const textWrap = document.createElement("span");
    textWrap.className = "multi-text";

    const name = document.createElement("strong");
    name.textContent = user.displayName;
    textWrap.appendChild(name);

    if (user.role){
      const roleLine = document.createElement("span");
      roleLine.className = "multi-meta";
      roleLine.textContent = user.role;
      textWrap.appendChild(roleLine);
    }

    if (user.login){
      const loginLine = document.createElement("span");
      loginLine.className = "multi-meta";
      loginLine.textContent = `@${user.login}`;
      textWrap.appendChild(loginLine);
    }

    if (user.email){
      const emailLine = document.createElement("span");
      emailLine.className = "multi-meta";
      emailLine.textContent = user.email;
      textWrap.appendChild(emailLine);
    } else if (user.meta){
      const metaLine = document.createElement("span");
      metaLine.className = "multi-meta";
      metaLine.textContent = user.meta;
      textWrap.appendChild(metaLine);
    }

    option.append(check, textWrap);
    applyOptionState(option, state.selected.has(user.id));

    option.addEventListener("click", ()=>{
      const alreadySelected = state.selected.has(user.id);
      if (alreadySelected){
        state.selected.delete(user.id);
      } else {
        state.selected.add(user.id);
      }
      applyOptionState(option, state.selected.has(user.id));
      renderSelected();
      updateHelp();
      notifyChange();
      if (!alreadySelected){
        clearSearch();
      }
      searchNode?.focus();
    });

    return option;
  }

  function renderOptions(){
    if (!optionsNode) return;
    optionsNode.innerHTML = "";

    if (state.loading){
      const loading = document.createElement("div");
      loading.className = "muted";
      loading.textContent = "Загрузка сотрудников…";
      optionsNode.appendChild(loading);
      return;
    }

    if (state.error){
      const err = document.createElement("div");
      err.className = "muted";
      err.textContent = state.error;
      optionsNode.appendChild(err);
      return;
    }

    const query = state.query.trim().toLowerCase();
    if (!query){
      const hint = document.createElement("div");
      hint.className = "muted";
      hint.textContent = "Начните вводить фамилию, должность или email.";
      optionsNode.appendChild(hint);
      return;
    }

    const matches = state.list.filter(user => user.searchText.includes(query));
    if (!matches.length){
      const none = document.createElement("div");
      none.className = "muted";
      none.textContent = "Совпадений не найдено.";
      optionsNode.appendChild(none);
      return;
    }

    matches.slice(0, 12).forEach(user => {
      const option = buildOption(user);
      optionsNode.appendChild(option);
    });
  }

  function applyPendingSelection(){
    if (!state.pendingSelection.size) return;
    const resolved = [];
    state.pendingSelection.forEach(id => {
      if (state.map.has(id)) resolved.push(id);
    });
    if (!resolved.length) return;
    state.selected = new Set(resolved);
    state.pendingSelection.clear();
    if (optionsNode){
      optionsNode.querySelectorAll(".multi-option").forEach(option => {
        const id = option.dataset.userId;
        applyOptionState(option, state.selected.has(id));
      });
    }
    renderSelected();
    updateHelp();
    notifyChange();
  }

  function setDropdownState(open){
    if (!wrapperNode) return;
    wrapperNode.classList.toggle("is-open", !!open);
    if (selectedNode){
      selectedNode.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (optionsNode){
      optionsNode.setAttribute("aria-hidden", open ? "false" : "true");
    }
  }

  function toggleDropdown(force){
    if (!wrapperNode){
      if (force === false){
        searchNode?.blur();
      } else if (force === true){
        searchNode?.focus();
      }
      return;
    }
    const open = typeof force === "boolean" ? force : !wrapperNode.classList.contains("is-open");
    setDropdownState(open);
    if (open){
      searchNode?.focus();
    }
  }

  function bindEvents(){
    if (searchNode){
      searchNode.addEventListener("focus", ()=>{
        toggleDropdown(true);
      });
      searchNode.addEventListener("input", ()=>{
        state.query = searchNode.value || "";
        renderOptions();
        toggleDropdown(true);
      });
      searchNode.addEventListener("keydown", event=>{
        if (event.key === "Enter"){
          event.preventDefault();
          const firstOption = optionsNode?.querySelector(".multi-option");
          if (firstOption){
            firstOption.click();
          }
        }
        if (event.key === "Escape"){
          event.preventDefault();
          clearSearch();
          toggleDropdown(false);
        }
      });
      searchNode.addEventListener("blur", ()=>{
        setTimeout(()=>{
          const active = document.activeElement;
          if (!wrapperNode?.contains(active)){
            setDropdownState(false);
          }
        }, 140);
      });
    }
    if (selectedNode){
      selectedNode.addEventListener("click", ()=>{
        toggleDropdown();
      });
      selectedNode.addEventListener("keydown", event=>{
        if (event.key === "Enter" || event.key === " "){
          event.preventDefault();
          toggleDropdown();
        }
        if (event.key === "Escape"){
          event.preventDefault();
          toggleDropdown(false);
          selectedNode.blur();
        }
      });
    }
    if (optionsNode){
      optionsNode.addEventListener("mousedown", event => {
        event.preventDefault();
      });
    }
    if (!state.outsideBound){
      document.addEventListener("mousedown", event=>{
        if (!wrapperNode) return;
        if (!wrapperNode.contains(event.target)){
          setDropdownState(false);
        }
      });
      state.outsideBound = true;
    }
  }

  async function loadDirectory(){
    state.loading = true;
    state.error = null;
    renderSelected();
    updateHelp();
    if (optionsNode){
      optionsNode.innerHTML = "";
      const loading = document.createElement("div");
      loading.className = "muted";
      loading.textContent = "Загрузка сотрудников…";
      optionsNode.appendChild(loading);
    }

    try{
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, login, role, email")
        .order("full_name", { ascending: true });
      if (error) throw error;

      const list = (data || []).map(row => {
        const displayName = row.full_name?.trim() || row.login?.trim() || row.email?.trim() || "Без имени";
        const login = row.login?.trim() || "";
        const email = row.email?.trim() || "";
        const roleTitle = row.role ? (ROLE_LABELS[row.role] || row.role) : "";
        const metaParts = [];
        if (roleTitle) metaParts.push(roleTitle);
        if (login) metaParts.push(`@${login}`);
        if (email) metaParts.push(email);
        const searchText = [displayName, roleTitle, login, email].join(" ").toLowerCase();
        return {
          id: row.id,
          displayName,
          meta: metaParts.join(" · "),
          role: roleTitle,
          login,
          email,
          searchText
        };
      });

      state.list = list;
      state.map.clear();
      list.forEach(user => state.map.set(user.id, user));

      const validIds = new Set(list.map(user => user.id));
      const nextSelected = new Set();
      state.selected.forEach(id => { if (validIds.has(id)) nextSelected.add(id); });
      state.selected = nextSelected;
      if (state.pendingSelection.size){
        applyPendingSelection();
      }

      state.loading = false;
      renderOptions();
      renderSelected();
      updateHelp();
      notifyChange();
    }catch(e){
      console.error("approvalPicker: не удалось загрузить пользователей", e);
      state.loading = false;
      state.error = e?.message || "Не удалось загрузить сотрудников";
      renderOptions();
      renderSelected();
      updateHelp();
    }
  }

  function reset(){
    state.selected.clear();
    state.pendingSelection.clear();
    clearSearch();
    if (optionsNode){
      optionsNode.querySelectorAll(".multi-option").forEach(option => applyOptionState(option, false));
    }
    renderSelected();
    updateHelp();
    notifyChange();
  }

  bindEvents();

  return {
    state,
    loadDirectory,
    getSelectedIds: () => Array.from(state.selected),
    getSelectedNames,
    reset,
    toggleDropdown,
    updateDisplay: renderSelected,
    updateHelp,
    clearQuery,
    setOnChange(handler){
      changeHandlers.clear();
      if (typeof handler === "function"){
        changeHandlers.add(handler);
        try{
          handler(Array.from(state.selected).map(id => {
            const info = state.map.get(id);
            return {
              id,
              name: info?.displayName || "Сотрудник",
              displayName: info?.displayName || "Сотрудник",
              meta: info?.meta || "",
              role: info?.role || "",
              login: info?.login || "",
              email: info?.email || ""
            };
          }));
        }catch(error){
          console.error("approvalPicker: onChange handler failed", error);
        }
      }
    },
    setSelected(ids){
      const list = Array.isArray(ids) ? ids.filter(Boolean).map(id => String(id)) : [];
      if (!list.length){
        state.pendingSelection.clear();
        state.selected.clear();
        clearSearch();
        if (optionsNode){
          optionsNode.querySelectorAll(".multi-option").forEach(option => applyOptionState(option, false));
        }
        renderSelected();
        updateHelp();
        notifyChange();
        return;
      }
      state.pendingSelection = new Set(list);
      applyPendingSelection();
    },
    getSelectedEntries(){
      return Array.from(state.selected).map(id => {
        const info = state.map.get(id);
        if (info){
          return {
            id,
            displayName: info.displayName,
            name: info.displayName,
            role: info.role,
            login: info.login,
            meta: info.meta,
            email: info.email || ""
          };
        }
        return { id, displayName: "Сотрудник", name: "Сотрудник" };
      });
    }
  };
}
