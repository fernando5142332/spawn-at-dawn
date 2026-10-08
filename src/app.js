(() => {
  const RD = window.RD || {};
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
  };
  const root = document.documentElement;

  // Tema claro / oscuro
  document.querySelector('.theme')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    store.set('rd-theme', next);
  });

  // Filtro por categoría en la portada
  const chips = document.querySelectorAll('.chip');
  chips.forEach((chip) => chip.addEventListener('click', () => {
    chips.forEach((c) => c.classList.toggle('on', c === chip));
    const cat = chip.dataset.filter;
    chip.closest('.block').querySelectorAll('.card').forEach((card) => { card.hidden = Boolean(cat) && card.dataset.cat !== cat; });
  }));

  // Copiar enlace
  document.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const label = btn.textContent;
      btn.textContent = RD.copied || 'OK';
      setTimeout(() => { btn.textContent = label; }, 1600);
    } catch { /* sin permiso de portapapeles */ }
  }));

  // Publicidad y modo sin anuncios
  const sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');
  const isPremium = () => (RD.premium || []).includes(store.get('rd-premium'));

  const form = document.querySelector('[data-premium]');
  if (form) {
    const msg = document.querySelector('.code-msg');
    if (isPremium()) msg.textContent = msg.dataset.on;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const hash = await sha256(form.code.value.trim().toUpperCase());
      const ok = (RD.premium || []).includes(hash);
      if (ok) store.set('rd-premium', hash);
      msg.textContent = ok ? msg.dataset.ok : msg.dataset.ko;
      if (ok) document.querySelectorAll('[data-ad]').forEach((el) => el.remove());
    });
  }

  if (RD.ads && !isPremium()) {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(RD.ads)}`;
    document.head.append(s);
    document.querySelectorAll('ins.adsbygoogle').forEach(() => (window.adsbygoogle = window.adsbygoogle || []).push({}));
  } else {
    document.querySelectorAll('[data-ad]').forEach((el) => el.remove());
  }
})();
