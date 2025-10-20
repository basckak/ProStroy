const REQUEST_MENU_SECTIONS = [
  {
    title: "СОГЛАСОВАНИЯ И ДОГОВОРЫ",
    items: [
      { label: "Заявка на заключение договора / допсоглашения", href: "./request-agreement-request.html" },
      { label: "Проверка контрагента", href: "./request-counterparty-review.html" },
      { label: "Протокол общего собрания (ОСС)", href: "./request-protocol-oss.html" },
      { label: "Договор аренды техники", href: "./request-lease-equipment.html" },
      { label: "Договор аренды имущества", href: "./request-lease-general.html" },
      { label: "Привлечение внешнего подрядчика", href: "./request-external-subcontract.html" },
      { label: "Договор подряда с физ. лицом", href: "./request-individual-subcontract.html" },
      { label: "Досудебное урегулирование", href: "./request-pretrial.html" }
    ]
  },
  {
    title: "ФИНАНСЫ",
    items: [
      { label: "Оплата по договорам ГПХ", href: "./request-payment-order.html?type=gph" },
      { label: "Оплата по трудовым договорам", href: "./request-payment-order.html?type=salary" },
      { label: "Авансовые платежи и подотчёты", href: "./request-advance-report.html" },
      { label: "Налоги и обязательные платежи", href: "./request-payment-order.html?type=tax" },
      { label: "Возврат / перерасчёт средств", href: "./request-payment-order.html?type=refund" },
      { label: "Финансирование проектов / объектов", href: "./request-payment-order.html?type=project" },
      { label: "Банковские операции и поручения", href: "./request-payment-order.html" }
    ]
  },
  {
    title: "ЛОГИСТИКА И ЭКСПЛУАТАЦИЯ",
    items: [
      { label: "Заявка на автотранспорт и спецтехнику", href: "./transport.html" }
    ]
  },
  {
    title: "ДОКУМЕНТООБОРОТ",
    items: [
      { label: "Входящий документ", href: "./request-incoming.html" },
      { label: "Исходящий документ", href: "./request-outgoing.html" },
      { label: "Внутренний документ", href: "./request-internal.html" },
      { label: "Черновик / без категории", href: "./request-unspecified.html" }
    ]
  }
];

function renderMenuMarkup(){
  return REQUEST_MENU_SECTIONS.map(section => {
    const links = section.items.map(item => `
      <a class="req-menu-link" href="${item.href}">
        <span class="req-menu-link-title">${item.label}</span>
      </a>
    `).join("");
    return `
      <article class="req-menu-section">
        <div class="req-menu-title">${section.title}</div>
        <div class="req-menu-grid">${links}</div>
      </article>
    `;
  }).join("");
}

export function setupNewRequestMenu({ button, container } = {}){
  if (!button || !container) return ()=>{};

  container.innerHTML = renderMenuMarkup();
  container.setAttribute("aria-hidden", "true");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-haspopup", "true");

  const closeMenu = ()=>{
    container.classList.remove("is-open");
    container.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
  };

  const openMenu = ()=>{
    container.classList.add("is-open");
    container.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
  };

  const onButtonClick = (event)=>{
    event.preventDefault();
    if (container.classList.contains("is-open")){
      closeMenu();
    }else{
      openMenu();
    }
  };

  const onContainerClick = (event)=>{
    const link = event.target.closest(".req-menu-link");
    if (!link) return;
    closeMenu();
  };

  const onDocumentClick = (event)=>{
    if (!container.classList.contains("is-open")) return;
    if (event.target === button || button.contains(event.target)) return;
    if (container.contains(event.target)) return;
    closeMenu();
  };

  const onKeyDown = (event)=>{
    if (event.key === "Escape") closeMenu();
  };

  button.addEventListener("click", onButtonClick);
  container.addEventListener("click", onContainerClick);
  document.addEventListener("click", onDocumentClick);
  window.addEventListener("keydown", onKeyDown);

  return ()=>{
    button.removeEventListener("click", onButtonClick);
    container.removeEventListener("click", onContainerClick);
    document.removeEventListener("click", onDocumentClick);
    window.removeEventListener("keydown", onKeyDown);
  };
}
