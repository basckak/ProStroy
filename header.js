(function(){
  const HEADER_URL = '/header.html';
  const sb = window.sb;

  const PENDING_STATUS_PREFIXES = ['на согласовании', 'на ознакомлении'];
  const PENDING_STATUS_EXACT = ['черновик', 'draft'];

  const normalizeStatus = status => (status || '').toString().trim().toLowerCase();

  function isPendingStatus(status){
    const normalized = normalizeStatus(status);
    if (!normalized) return true;
    if (normalized === 'in_review') return true;
    if (normalized === 'draft') return true;
    if (PENDING_STATUS_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
    if (PENDING_STATUS_EXACT.includes(normalized)) return true;
    if (normalized.includes('ожид') && !normalized.includes('одобр') && !normalized.includes('откл')) return true;
    return false;
  }

  async function getSessionSoft(retryMs = 50){
    if (!sb) return null;
    let { data: { session } = { session: null } } = await sb.auth.getSession();
    if (!session && retryMs){
      await new Promise(resolve => setTimeout(resolve, retryMs));
      ({ data: { session } = { session: null } } = await sb.auth.getSession());
    }
    return session;
  }

  function highlightActiveLink(root = document){
    const pathLower = location.pathname.toLowerCase();
    const here = (pathLower.split('/').pop() || 'index.html').toLowerCase();
    const docsPath = here.startsWith('docs/') ? 'documents.html' : here;
    const anchors = root.querySelectorAll('a.ps-link[href], a.ps-sub-link[href]');
    anchors.forEach(anchor => {
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      let target = href.toLowerCase();
      if (target.startsWith('/')){
        target = target.slice(1);
      }else if (target.startsWith('./')){
        target = target.slice(2);
      }
      target = target.split('#')[0];
      if (target === 'docs' || target.startsWith('docs/')){
        target = 'documents.html';
      } else {
        target = target.split('/').pop();
      }
      if (target && target === here){
        anchor.classList.add('is-active');
        const menu = anchor.closest('[data-menu]');
        if (menu){
          menu.classList.add('is-current');
          const toggle = menu.querySelector('.ps-toggle');
          if (toggle) toggle.classList.add('is-active');
        }
      }
    });

    if (pathLower.includes('/docs/')){
      const docsLink = root.querySelector('a.ps-link[href="./documents.html"], a.ps-link[href="/documents.html"]');
      if (docsLink){
        docsLink.classList.add('is-active');
      }
    }
  }

  function initDropdowns(root=document){
    const menus = Array.from(root.querySelectorAll('[data-menu]'));
    if (!menus.length) return;

    const closeAll = () => {
      menus.forEach(menu => {
        menu.classList.remove('is-open');
        const toggle = menu.querySelector('.ps-toggle');
        if (toggle){
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    };

    menus.forEach(menu => {
      const toggle = menu.querySelector('.ps-toggle');
      if (!toggle) return;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', event => {
        event.preventDefault();
        const isOpen = menu.classList.contains('is-open');
        closeAll();
        if (!isOpen){
          menu.classList.add('is-open');
          toggle.setAttribute('aria-expanded', 'true');
        }
      });
    });

    root.addEventListener('click', event => {
      if (menus.some(menu => menu.contains(event.target))){
        const link = event.target.closest('.ps-sub-link');
        if (link){
          closeAll();
        }
        return;
      }
      closeAll();
    });

    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeAll();
    });
  }

  async function resolveDisplayName(user) {
    if (!user) return 'Пользователь';

    if (sb && window.ENV?.PROFILE_LOOKUP !== 'off'){
      try {
        const { data, error } = await sb
          .from('profiles')
          .select('full_name, login, email')
          .eq('id', user.id)
          .maybeSingle();
        if (!error && data){
          if (data.full_name && data.full_name.trim()) return data.full_name.trim();
          if (data.login && data.login.trim()) return data.login.trim();
          if (data.email && data.email.trim()) return data.email.trim();
        }
      } catch (fetchError) {
        console.warn('[ProStroy] resolveDisplayName profile lookup', fetchError);
      }
    }

    const meta =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.user_metadata?.login ||
      user.email;
    if (meta && meta.trim?.()){
      return meta.trim();
    }

    return user.email || 'Пользователь';
  }

  async function renderUser(root=document){
    const el = root.getElementById ? root.getElementById('ps-user-name') : document.getElementById('ps-user-name');
    if (!el) return;
    el.textContent = 'Загрузка…';
    const session = await getSessionSoft();
    if (!session){ el.textContent = 'Гость'; return; }
    el.textContent = await resolveDisplayName(session.user);
  }

  async function fetchPendingCounter(userId){
    if (!sb || !userId) return 0;
    try{
      const [transport, assignments, contracts] = await Promise.all([
        sb
          .from('transport_requests')
          .select('status')
          .contains('approver_ids', [userId])
          .limit(120),
        sb
          .from('document_approval_assignments')
          .select('status, approver_ids')
          .contains('approver_ids', [userId])
          .limit(120),
        sb
          .from('contract_documents')
          .select('status, approver_ids')
          .contains('approver_ids', [userId])
          .limit(120)
      ]);

      let total = 0;
      if (!transport.error && Array.isArray(transport.data)){
        total += transport.data.filter(row => isPendingStatus(row.status)).length;
      }
      if (!assignments.error && Array.isArray(assignments.data)){
        total += assignments.data.filter(row => isPendingStatus(row.status)).length;
      }
      if (!contracts.error && Array.isArray(contracts.data)){
        total += contracts.data.filter(row => isPendingStatus(row.status)).length;
      }
      return total;
    }catch(error){
      console.warn('[ProStroy] pending counter failed', error);
      return 0;
    }
  }

  async function updatePendingCounter(root=document){
    const badge = root.getElementById ? root.getElementById('ps-approvals-counter') : document.getElementById('ps-approvals-counter');
    if (!badge) return;
    const session = await getSessionSoft();
    if (!session){
      badge.hidden = true;
      return;
    }
    const total = await fetchPendingCounter(session.user.id);
    if (total > 0){
      badge.textContent = String(total);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function bindActions(root=document){
    const btnLogout = root.getElementById ? root.getElementById('ps-logout') : document.getElementById('ps-logout');
    if (btnLogout){
      btnLogout.addEventListener('click', async ()=>{
        if (sb){
          try { await sb.auth.signOut(); } catch(_){}
        }
        location.reload();
      });
    }
    initDropdowns(root);
    if (sb){
      sb.auth.onAuthStateChange((_evt, session)=>{
        if (session) renderUser(root);
        updatePendingCounter(root).catch(err => console.warn('[ProStroy] header counter', err));
      });
    }
  }

  async function loadHeader(){
    const mount = document.getElementById('header');
    if (!mount){ console.warn('[ProStroy] #header не найден'); return; }
    try{
      const resp = await fetch(HEADER_URL, { cache: 'no-cache' });
      if (!resp.ok){
        throw new Error(`header fetch ${resp.status}`);
      }
      mount.innerHTML = await resp.text();
      highlightActiveLink(mount.ownerDocument);
      bindActions(mount.ownerDocument);
      await renderUser(mount.ownerDocument);
      await updatePendingCounter(mount.ownerDocument);
    }catch(error){
      console.error('[ProStroy] Не удалось загрузить header', error);
    }
  }

  window.loadHeader = loadHeader;
  window.headerReady = loadHeader().catch(err => {
    console.error('[ProStroy] header init', err);
  });
})();
