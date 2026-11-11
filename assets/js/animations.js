/* =========================================================
   América Licenciamentos — animações da home (ver ANIMACOES.md)
   Conceito "carimbo de cartório": cada revelação acontece uma
   única vez, por tempo (nunca amarrada à rolagem), e termina
   exatamente no estado validado do Figma.
   - Sem biblioteca: Web Animations API + IntersectionObserver.
   - Sempre fill:'backwards' → ao terminar, o efeito some e quem
     manda volta a ser o style.css.
   - Toda escrita temporária no DOM é revertida (§7.8).
   - Carregar DEPOIS do main.js (defer preserva a ordem).
   ========================================================= */
(function () {
  'use strict';

  var d = document, w = window, html = d.documentElement;
  if (!html.classList.contains('motion-ok')) return;   // reduce, ?static ou navegador sem suporte

  var EASE = 'cubic-bezier(.22,1,.36,1)';
  var EASE_DRAW = 'cubic-bezier(.65,0,.35,1)';
  var EASE_FADE = 'cubic-bezier(.33,1,.68,1)';
  var CONFIG = { chapterOpen: true };   // abertura de capítulo dos cards escuros (desligável)

  var noop = function () {};
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $$(s, root) { return Array.prototype.slice.call((root || d).querySelectorAll(s)); }

  /* ---------------------------------------------------------
     Molduras: .a-clip (isolation) só enquanto algo escala dentro
     --------------------------------------------------------- */
  var clipCount = new WeakMap();
  function clipOn(el) {
    if (!el) return;
    var n = (clipCount.get(el) || 0) + 1;
    clipCount.set(el, n);
    if (n === 1) el.classList.add('a-clip');
  }
  function clipOff(el) {
    if (!el) return;
    var n = (clipCount.get(el) || 1) - 1;
    clipCount.set(el, n);
    if (n <= 0) { clipCount.delete(el); el.classList.remove('a-clip'); }
  }

  /* ---------------------------------------------------------
     Microinterações (§9): .a-enter só após clique do usuário
     --------------------------------------------------------- */
  var timers = new WeakMap();
  function enter(el, ms) {
    if (!el) return;
    clearTimeout(timers.get(el));
    el.classList.remove('a-enter'); void el.offsetWidth; el.classList.add('a-enter');   // reflow só no clique
    timers.set(el, setTimeout(function () { el.classList.remove('a-enter'); }, ms));
  }

  // Listeners registrados depois dos do main.js → rodam depois dele.
  var docs = d.querySelector('[data-docs]'), docsArt = d.querySelector('[data-docs-art]');
  if (docs) {
    docs.addEventListener('docs:manual-change', function () {
      var cur = docs.querySelector('.doc.is-active');
      enter(cur, 700);
      var img = docsArt && docsArt.querySelector('img.is-active');
      if (img) {
        enter(img, 650);
        clipOn(docsArt);
        setTimeout(function () { clipOff(docsArt); }, 650);
      }
    });
  }
  var faq = d.querySelector('[data-faq]');
  if (faq) {
    var lastFaq = faq.querySelector('.faq-item.is-open');
    faq.addEventListener('click', function () {
      var cur = faq.querySelector('.faq-item.is-open');
      if (cur && cur !== lastFaq) enter(cur, 500);
      lastFaq = cur;
    });
  }
  var testi = d.querySelector('[data-slider="testimonials"]');
  if (testi) {
    testi.addEventListener('click', function (e) {
      if (e.target.closest('[data-prev], [data-next], [data-dots] button')) {
        enter(testi.querySelector('.testimonial.is-active'), 560);
      }
    });
  }

  /* ---------------------------------------------------------
     Estado do motor
     --------------------------------------------------------- */
  var pending = new Set();     // elementos marcados (data-anim) ou gatilhos ainda não resolvidos
  var running = new Set();     // animações WAAPI vivas
  var splits = new Set();      // títulos divididos em linhas
  var counters = new Set();    // contadores ativos (função de término)
  var records = [], recOf = new Map(), depOf = new Map(), trig = new Map();
  var busy = 0, heroLeft = 0, heroDone = true, halt = false, cleaned = false, booted = false;
  var heroEls = [], ioIn, ioFoot, ioPre, lastW = w.innerWidth, minStart = 0;
  var lite = false, small = false, audit = false, snap = null, svgSeq = 0;

  /* Movimento reduzido no meio da sessão (§10) */
  var mqReduce = w.matchMedia('(prefers-reduced-motion: reduce)');
  var onReduce = function (e) {
    if (!e.matches) return;
    finishAll();
    html.classList.remove('js-anim', 'anim-ready', 'motion-ok', 'hero-anim');
  };
  if (mqReduce.addEventListener) mqReduce.addEventListener('change', onReduce);
  else if (mqReduce.addListener) mqReduce.addListener(onReduce);

  if (!html.classList.contains('js-anim')) return;   // watchdog já desligou as revelações

  /* ---------------------------------------------------------
     Núcleo (§7.4)
     --------------------------------------------------------- */
  var UP = function (px) { return [{ opacity: 0, translate: '0 ' + px + 'px' }, { opacity: 1, translate: '0 0' }]; };
  var FADE = [{ opacity: 0 }, { opacity: 1 }];
  var WIPE_X = [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }];
  var WIPE_Y = [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }];
  var CHAPTER = [{ clipPath: 'inset(0 1.5% 0 1.5% round 24px)' }, { clipPath: 'inset(0 0% 0 0% round 24px)' }];
  var SCALE = function (s) { return [{ scale: s }, { scale: 1 }]; };
  var LINE = [{ translate: '0 105%' }, { translate: '0 0' }];

  function dist(px) { return small ? px * 0.75 : px; }

  // Anima sem tocar em classes; cb roda ao terminar (ou na hora, se parado)
  function anim(el, frames, o, cb) {
    if (halt) { if (cb) cb(); return null; }
    var a;
    try {
      a = el.animate(frames, {
        duration: o.dur, delay: Math.max(0, o.delay || 0), easing: o.ease || EASE,
        fill: 'backwards'                        // NUNCA 'forwards' ou 'both'
      });
      a.id = 'a-' + (o.kind || 'reveal');        // prefixo usado pela auditoria
    } catch (err) {                              // WAAPI falhou: estado final na hora
      report(err);
      if (a) { try { a.cancel(); } catch (e) {} }
      if (cb) cb();
      return null;
    }
    running.add(a);
    var done = function () {
      running.delete(a);
      try { if (cb) cb(); } catch (err) { report(err); hardStop(); return; }
      maybeCleanup();
    };
    a.finished.then(done, done);
    return a;
  }

  /* ---------------------------------------------------------
     Rede de segurança (restrição 2): erro depois do boot nunca
     deixa conteúdo escondido.
     - guard(r): erro num registro → só ele assenta, sem animação
     - hardStop(): último recurso → tudo assenta e sai js-anim
     --------------------------------------------------------- */
  var faults = 0;
  function report(err) { faults++; if (w.console) console.error('[animations]', err); }

  function release(r) {
    var els = [r.el].concat(r.deps.map(function (x) { return x.el; }));
    splits.forEach(function (sp) {
      if (els.some(function (el) { return el === sp.el || el.contains(sp.el); })) {
        try { unsplit(sp); } catch (e) { splits.delete(sp); }
      }
    });
    r.done = false;
    try { settleRecord(r); } catch (e) { hardStop(); }
  }

  function hardStop() {
    if (cleaned) return;
    try { finishAll(); } catch (e) { halt = true; }
    splits.forEach(function (sp) { try { unsplit(sp); } catch (e) {} });
    splits.clear(); running.clear(); pending.clear(); counters.clear();
    busy = 0; heroDone = true; booted = true;
    $$('[data-anim]').forEach(function (el) { el.removeAttribute('data-anim'); el.classList.remove('is-in'); });
    html.classList.remove('js-anim', 'anim-ready', 'hero-anim');   // sem js-anim não existe estado escondido
    try { maybeCleanup(); } catch (e) { cleaned = true; }
  }

  // Erro não capturado vindo deste arquivo (evento, promessa, timer) → último recurso
  var ME = /animations\.js/;
  w.addEventListener('error', function (ev) {
    if (!cleaned && ev && ev.filename && ME.test(ev.filename)) { faults++; hardStop(); }
  });
  w.addEventListener('unhandledrejection', function (ev) {
    var s = ev && ev.reason && ev.reason.stack;
    if (!cleaned && s && ME.test(s)) { faults++; hardStop(); }
  });

  // Revelação: tira o pré-estado do CSS na MESMA tarefa em que anima
  function play(el, frames, o) {
    el.classList.add('is-in');
    return anim(el, frames, o, function () { (o.after || settle)(el); });
  }

  function settle(el) {
    if (el.hasAttribute('data-anim')) { el.removeAttribute('data-anim'); el.classList.remove('is-in'); }
    pending.delete(el);
    maybeCleanup();
  }

  /* ---------------------------------------------------------
     Revelação por linhas, com divisor medido (§7.5)
     --------------------------------------------------------- */
  function unsplit(sp) {
    if (!splits.has(sp)) return;
    splits.delete(sp);
    sp.el.textContent = '';
    sp.el.appendChild(sp.text);                  // o MESMO nó Text
    if (sp.style === null) sp.el.removeAttribute('style'); else sp.el.setAttribute('style', sp.style);
  }

  // Qualquer falha na medição (fontes, Range, layout) → null = revelação em bloco
  function splitLines(el) {
    try { return splitLinesRaw(el); } catch (err) {
      report(err);
      splits.forEach(function (sp) { if (sp.el === el) { try { unsplit(sp); } catch (e) { splits.delete(sp); } } });
      return null;
    }
  }
  function splitLinesRaw(el) {
    if (el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) return null;
    var cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight);
    if (!lh || !d.fonts || !d.fonts.check(cs.fontWeight + ' ' + cs.fontSize + ' "Stack Sans Headline"')) return null;
    var text = el.firstChild, s = text.data, r = d.createRange(), lines = [], start = 0, top = null;
    // Medir (só leitura): o 1º caractere de cada palavra diz em que linha caiu
    // (a linha só quebra em espaço ou depois de hífen/barra; a autoverificação abaixo cobre o resto)
    for (var i = 0; i < s.length; i++) {
      if (/\s/.test(s.charAt(i))) continue;
      if (i > 0 && !/[\s\-\u2010-\u2014\/]/.test(s.charAt(i - 1))) continue;
      r.setStart(text, i); r.setEnd(text, i + 1);
      var rc = r.getClientRects();
      if (!rc.length) continue;
      if (top === null) top = rc[0].top;
      else if (rc[0].top > top + lh / 2) { lines.push(s.slice(start, i)); start = i; top = rc[0].top; }
    }
    lines.push(s.slice(start));
    var rect = el.getBoundingClientRect();
    var sp = { el: el, text: text, style: el.getAttribute('style'), ins: [], anims: [] };
    splits.add(sp);
    // Trava a largura via atributo (não via el.style: no Chrome, CSSOM + removeAttribute deixa style="")
    el.setAttribute('style', (sp.style ? sp.style.replace(/;?\s*$/, ';') : '') + 'width:' + rect.width + 'px');
    el.textContent = '';
    lines.forEach(function (l) {
      var o = d.createElement('span'), n = d.createElement('span');
      o.className = 'ln'; n.className = 'ln__in'; n.textContent = l;
      o.appendChild(n); el.appendChild(o); sp.ins.push(n);
    });
    // Autoverificação: mesma caixa e nenhuma linha quebrada
    var r2 = el.getBoundingClientRect();
    var ok = Math.abs(r2.width - rect.width) <= 0.5 && Math.abs(r2.height - rect.height) <= 0.5;
    sp.ins.forEach(function (n) { if (n.getBoundingClientRect().height > 1.5 * lh) ok = false; });
    if (!ok) { unsplit(sp); return null; }
    return sp;
  }

  // Devolve o "rabo" (atraso da última linha) para quem depende do fim da fala
  function runLines(el, D, o, after) {
    after = after || settle;
    var sp = halt ? null : splitLines(el);
    if (!sp) {
      play(el, UP(dist(20)), { dur: 800, delay: D, after: after });
      return 150;                                // fallback em bloco: assinatura em +350
    }
    busy++;
    el.classList.add('is-in');
    var n = sp.ins.length, step = n > 1 ? Math.min(90, 450 / (n - 1)) : 0, left = n;
    sp.ins.forEach(function (inn, i) {
      var a = anim(inn, LINE, { dur: o.dur || 950, delay: D + i * step, kind: 'line' }, function () {
        if (--left) return;
        unsplit(sp); busy--; after(el);
      });
      if (a) sp.anims.push(a);
    });
    return (n - 1) * step;
  }

  /* ---------------------------------------------------------
     Desenho técnico das ilustrações (§7.6)
     --------------------------------------------------------- */
  var svgCache = {};
  function getSvg(url) {
    if (!svgCache[url]) {
      var p = (location.protocol === 'file:' || !w.fetch || !w.DOMParser)
        ? Promise.reject(new Error('sem fetch'))
        : fetch(url, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
      p.catch(noop);
      svgCache[url] = p;
    }
    return svgCache[url];
  }

  function buildSvg(text, img) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
    // Sanitizar
    $$('script, foreignObject, style', root).forEach(function (e) { e.parentNode.removeChild(e); });
    var all = [root].concat($$('*', root)), suf = '-a' + (++svgSeq);
    // Namespacing por instância: ids e referências ganham o sufixo
    all.forEach(function (e) { var id = e.getAttribute('id'); if (id) e.setAttribute('id', id + suf); });
    all.forEach(function (e) {
      Array.prototype.slice.call(e.attributes).forEach(function (a) {
        var nm = a.name, v = a.value;
        if (/^on/i.test(nm)) { e.removeAttributeNode(a); return; }
        if (nm === 'href' || nm === 'xlink:href') {
          if (v.charAt(0) !== '#') e.removeAttributeNode(a); else a.value = v + suf;
          return;
        }
        if (v.indexOf('url(#') >= 0) a.value = v.replace(/url\(#([^)]+)\)/g, function (m, id) { return 'url(#' + id + suf + ')'; });
      });
    });
    var svg = d.importNode(root, true);
    svg.setAttribute('class', img.getAttribute('class') || '');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return svg;
  }

  var ART = {
    cta:  { dur: 1300, step: 70, budget: 600, bbox: false, wipe: 'wipe-x', wdur: 1000 },
    step: { dur: 900,  step: 50, budget: 300, bbox: true,  wipe: 'wipe-y', wdur: 1100 },
    faq:  { dur: 1300, step: 70, budget: 600, bbox: true,  wipe: 'wipe-y', wdur: 1100 }
  };

  // Fallback / lite: o <img> fica intocado e recebe um wipe
  function wipeArt(img, D, P) {
    img.setAttribute('data-anim', P.wipe);
    play(img, P.wipe === 'wipe-x' ? WIPE_X : WIPE_Y, { dur: P.wdur, delay: D, ease: EASE_DRAW, kind: 'wipe' });
  }

  function runDraw(img, D, kind) {
    var P = ART[kind];
    if (lite) { wipeArt(img, D, P); return; }
    busy++;
    var t0 = performance.now(), fired = false;
    var go = function (text) {
      if (fired) return;
      fired = true; busy--;
      try {
        if (halt) { settle(img); return; }
        var rest = Math.max(0, D - (performance.now() - t0));
        var svg = null;
        try { svg = text ? buildSvg(text, img) : null; } catch (e) { svg = null; }
        if (!svg) { wipeArt(img, rest, P); return; }
        drawSvg(img, svg, rest, P);
      } catch (err) { report(err); settle(img); }
    };
    getSvg(img.currentSrc || img.src).then(go, function () { go(null); });
    setTimeout(function () { go(null); }, 300);   // SVG não chegou em 300 ms → wipe
  }

  // Falha no meio do desenho → o <img> original volta, já no estado final
  function drawSvg(img, svg, D, P) {
    busy++;
    try { drawSvgRaw(img, svg, D, P); } catch (err) {
      report(err);
      if (svg.parentNode) { try { svg.replaceWith(img); } catch (e) {} }
      if (img.isConnected) { busy--; settle(img); } else hardStop();
    }
  }
  function drawSvgRaw(img, svg, D, P) {
    img.replaceWith(svg);
    var paths = $$('path', svg).filter(function (p) { return !p.closest('defs') && !p.closest('clipPath'); });
    if (P.bbox) {
      var top = new Map();
      paths.forEach(function (p) { var y = 0; try { y = p.getBBox().y; } catch (e) {} top.set(p, y); });
      paths.sort(function (a, b) { return top.get(a) - top.get(b); });
    }
    var n = paths.length, step = n > 1 ? Math.min(P.step, P.budget / (n - 1)) : 0, left = n;
    var restore = function () {
      var fin = function () {
        img.removeAttribute('data-anim'); img.classList.remove('is-in');
        if (svg.parentNode) svg.replaceWith(img);   // o <img> original volta
        pending.delete(img); busy--; maybeCleanup();
      };
      (img.decode ? img.decode() : Promise.resolve()).then(fin, fin);
    };
    if (!n) { restore(); return; }
    paths.forEach(function (p, i) {
      p.setAttribute('pathLength', '1');
      var f = parseFloat(p.getAttribute('fill-opacity') || '1');
      anim(p, [
        { strokeDasharray: '1 2', strokeDashoffset: 1.02, fillOpacity: 0 },
        { strokeDasharray: '1 2', fillOpacity: 0, offset: 0.7 },
        { strokeDasharray: '1 2', strokeDashoffset: 0, fillOpacity: f }
      ], { dur: P.dur, delay: D + i * step, ease: EASE_DRAW, kind: 'draw' }, function () { if (!--left) restore(); });
    });
  }

  /* ---------------------------------------------------------
     Contador "+20 anos" (§7.7)
     --------------------------------------------------------- */
  function runCount(strong, D) {
    try { runCountRaw(strong, D); } catch (err) { report(err); counters.forEach(function (end) { if (end.el === strong) end(); }); }
  }
  function runCountRaw(strong, D) {
    if (halt || !strong || strong.childNodes.length !== 1 || strong.firstChild.nodeType !== 3) return;
    var m = /^(\D*)(\d+)(.*)$/.exec(strong.firstChild.data);
    if (!m) return;
    var orig = strong.firstChild, tmp = d.createTextNode(m[1] + '0' + m[3]), sr = d.createElement('span');
    var aria = strong.getAttribute('aria-hidden'), target = parseInt(m[2], 10), done = false;
    sr.className = 'sr-only'; sr.textContent = orig.data;
    var end = function () {                      // tolera estado parcial (falha no meio da troca)
      if (done) return;
      done = true; counters.delete(end); busy--;
      try {
        if (tmp.parentNode === strong) strong.replaceChild(orig, tmp);   // o MESMO nó Text
        if (aria === null) strong.removeAttribute('aria-hidden'); else strong.setAttribute('aria-hidden', aria);
        if (sr.parentNode) sr.parentNode.removeChild(sr);
      } catch (err) { report(err); }
      maybeCleanup();
    };
    end.el = strong;
    busy++; counters.add(end);
    strong.replaceChild(tmp, orig);
    strong.setAttribute('aria-hidden', 'true');
    strong.parentNode.insertBefore(sr, strong.nextSibling);
    var t0 = performance.now() + D + 150;
    var tick = function (now) {
      if (done) return;
      try {
        var p = Math.min(1, Math.max(0, (now - t0) / 1400)), e = 1 - Math.pow(1 - p, 3);
        tmp.data = m[1] + Math.round(e * target) + m[3];
        if (p >= 1) end(); else requestAnimationFrame(tick);
      } catch (err) { report(err); end(); }
    };
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------
     Executor de efeitos
     --------------------------------------------------------- */
  function runFx(el, e, D) {
    switch (e.fx) {
      case 'up':      play(el, UP(dist(e.d)), { dur: e.dur, delay: D, ease: e.ease }); return 0;
      case 'fade':    play(el, FADE, { dur: e.dur, delay: D, ease: e.ease || EASE_FADE }); return 0;
      case 'wipe-x':  play(el, WIPE_X, { dur: e.dur, delay: D, ease: e.ease || EASE_DRAW, kind: 'wipe' }); return 0;
      case 'wipe-y':  play(el, WIPE_Y, { dur: e.dur, delay: D, ease: e.ease || EASE_DRAW, kind: 'wipe' }); return 0;
      case 'chapter': play(el, CHAPTER, { dur: 900, delay: D, kind: 'chapter' }); return 0;
      case 'lines':   return runLines(el, D, e);
      case 'draw':    runDraw(el, D, e.art); return 0;
      case 'count':   runCount(el, D); return 0;
      case 'scale':
        var frame = el.parentElement;
        if (halt) return 0;
        clipOn(frame);
        anim(el, SCALE(e.from), { dur: e.dur, delay: D, kind: 'scale' }, function () { clipOff(frame); });
        return 0;
    }
    return 0;
  }
  var MARKS = { up: 1, fade: 1, 'wipe-x': 1, 'wipe-y': 1, chapter: 1, lines: 1, draw: 1 };

  /* ---------------------------------------------------------
     SPEC declarativo (§8). g = grupo (seção); at = atraso relativo;
     lote = passo do escalonamento; diag = passo diagonal dos logos.
     Atrasos só valem entre alvos do MESMO callback (§5.4).
     --------------------------------------------------------- */
  var stepChain = function (c) { return c.D - c.li * c.ls + 250 + c.li * (lite ? 150 : 400); };
  var CTA_ART = { s: '.cta-box__art', fx: 'draw', art: 'cta', at: 200 };
  var SPEC = [
    // 3. Empresas que confiam
    { g: 'trust', s: '.trust__title', fx: 'up', d: 12, dur: 600 },
    { g: 'trust', s: '.trust .logo-grid__cell img', fx: 'up', d: 8, dur: 500, at: 120, diag: 40, load: 400 },
    // 4. Decisão empresarial
    { g: 'property', s: '.property .section-head__title > .eyebrow', fx: 'up', d: 12, dur: 600 },
    { g: 'property', s: '#property-title', fx: 'lines', at: 80 },
    { g: 'property', s: '.property .feature', fx: 'up', d: 24, dur: 800, lote: 110, decode: '.feature__img > img',
      deps: [{ s: '.feature__img > img', fx: 'scale', from: 1.06, dur: 1400 }] },
    { g: 'property', s: '.property .cta-box', fx: 'up', d: 16, dur: 700, deps: [CTA_ART] },
    // 6. Soluções
    { g: 'docs', s: '.docs__intro .eyebrow', fx: 'up', d: 12, dur: 600 },
    { g: 'docs', s: '#docs-title', fx: 'lines', at: 80 },
    { g: 'docs', s: '.docs__intro > p.t-body', fx: 'up', d: 16, dur: 700, at: 200 },
    { g: 'docs', s: '.docs__list > li.doc', fx: 'up', d: 16, dur: 600, lote: 50, cap: 400 },
    { g: 'docs', s: '.docs__art[data-docs-art]', fx: 'fade', dur: 600, decode: 'img.is-active',
      deps: [{ s: 'img.is-active', fx: 'scale', from: 1.06, dur: 1400 }] },
    { g: 'docs', s: '.docs .cta-box', fx: 'up', d: 16, dur: 700, deps: [{ s: '.cta-box__art', fx: 'draw', art: 'cta', at: 200 }] },
    // 7. Método
    { g: 'method', s: '.method .section-head__title > .eyebrow', fx: 'up', d: 12, dur: 600 },
    { g: 'method', s: '#method-title', fx: 'lines', at: 80 },
    { g: 'method', s: '.method__desc', fx: 'up', d: 16, dur: 700, at: 200 },
    { g: 'method', s: '.steps > li.step', fx: 'up', d: 24, dur: 800, lote: 110,
      deps: [{ s: '.step__art', fx: 'draw', art: 'step', delay: stepChain }] },
    // 8. Sobre
    { g: 'about', s: '.about > .card-section__inner', fx: 'chapter',
      when: function () { return CONFIG.chapterOpen && !lite && w.innerWidth >= 961; } },
    { g: 'about', s: '.about__intro-left .eyebrow--dark', fx: 'up', d: 12, dur: 600 },
    { g: 'about', s: '#about-title', fx: 'lines', at: 80 },
    { g: 'about', s: '.about__intro-left .dot-pattern', fx: 'wipe-x', dur: 1000, at: 300 },
    { g: 'about', s: '.about__intro .stack-p > p', fx: 'up', d: 16, dur: 700, lote: 100 },
    { g: 'about', s: '.stats > li.stat', fx: 'wipe-y', dur: 800, lote: 120,
      deps: [{ s: ':scope > strong', fx: 'count', first: true }] },
    { g: 'about', s: '.about__slides[data-fade]', fx: 'fade', dur: 700, decode: 'img.is-active',
      deps: [{ s: 'img.is-active', fx: 'scale', from: 1.05, dur: 1600 }] },
    { g: 'about', s: '.about__profile > .t-h2', fx: 'lines', dur: 1000,
      deps: [{ get: function (el) { return el.parentNode.querySelector('.about__author'); }, fx: 'up', d: 12, dur: 600,
               delay: function (c) { return c.D + c.tail + 200; } }] },
    { g: 'about', s: '.about__foot .dot-pattern', fx: 'wipe-x', dur: 1000 },
    { g: 'about', s: '.about__foot .link-caret--light', fx: 'fade', dur: 600, at: 200 },
    // 9. Cases
    { g: 'cases', s: '.cases__glow', fx: 'fade', dur: 1400, ease: EASE },
    { g: 'cases', s: 'img.cases__logo', fx: 'up', d: 12, dur: 600, at: 150 },
    { g: 'cases', s: '#cases-title', fx: 'lines', at: 250 },
    { g: 'cases', s: '.cases__desc', fx: 'up', d: 16, dur: 700, at: 400 },
    { g: 'cases', s: 'ul.sectors', fx: 'up', d: 16, dur: 700 },
    { g: 'cases', s: '.cases .logo-grid__cell img', fx: 'up', d: 8, dur: 500, diag: 35, load: 400 },
    { g: 'cases', s: '.cases__cta > .btn', fx: 'up', d: 16, dur: 600 },
    // 10. Depoimentos (nunca marcar .testimonial)
    { g: 'testi', s: '.testimonials__head .eyebrow', fx: 'up', d: 12, dur: 600 },
    { g: 'testi', s: '#testimonials-title', fx: 'up', d: 20, dur: 800, at: 80 },
    { g: 'testi', s: '.testimonials__head .slider-nav', fx: 'fade', dur: 600, at: 250 },
    { g: 'testi', s: '.testimonials__track[data-track]', fx: 'up', d: 20, dur: 800, at: 150 },
    // 11. Para contadores
    { g: 'acc', s: '.accountants > .card-section__inner', fx: 'chapter',
      when: function () { return CONFIG.chapterOpen && !lite && w.innerWidth >= 961; } },
    { g: 'acc', s: '.accountants__text .eyebrow--dark', fx: 'up', d: 12, dur: 600 },
    { g: 'acc', s: '#acc-title', fx: 'up', d: 20, dur: 800, at: 80 },
    { g: 'acc', s: '.accountants__text .stack-p > p', fx: 'up', d: 16, dur: 700, lote: 90 },
    { g: 'acc', s: '.accountants__text > .link-caret--light', fx: 'fade', dur: 600 },
    { g: 'acc', s: '.accountants__img', fx: 'fade', dur: 700, decode: 'img',
      deps: [{ s: 'img', fx: 'scale', from: 1.06, dur: 1400 }] },
    { g: 'acc', s: 'ol.accountants__steps', fx: 'none', deps: [
      { s: ':scope > li:nth-child(1)', fx: 'up', d: 12, dur: 600, at: 0, ease: EASE },
      { s: ':scope > li:nth-child(2) > svg', fx: 'wipe-y', dur: 600, at: 160 },
      { s: ':scope > li:nth-child(3)', fx: 'up', d: 12, dur: 600, at: 400 },
      { s: ':scope > li:nth-child(4) > svg', fx: 'wipe-y', dur: 600, at: 560 },
      { s: ':scope > li:nth-child(5)', fx: 'up', d: 12, dur: 600, at: 800 }
    ] },
    // 12. Conteúdos (nunca .blog__track nem .post__img img)
    { g: 'blog', s: '.blog__head .eyebrow', fx: 'up', d: 12, dur: 600 },
    { g: 'blog', s: '#blog-title', fx: 'lines', at: 80 },
    { g: 'blog', s: '.blog__head > .link-caret', fx: 'fade', dur: 600, at: 200 },
    { g: 'blog', s: '.blog__viewport', fx: 'none', deps: [{ all: '.post', fx: 'up', d: 20, dur: 700, inView: 100 }] },
    { g: 'blog', s: '.blog .slider-nav', fx: 'fade', dur: 600, at: 300 },
    // 13. FAQ
    { g: 'faq', s: '#faq-title', fx: 'lines' },
    { g: 'faq', s: '.faq__box', fx: 'up', d: 16, dur: 700, at: 120, deps: [{ s: '.faq__art', fx: 'draw', art: 'faq', at: 250 }] },
    { g: 'faq', s: '[data-faq] > .faq-item', fx: 'up', d: 12, dur: 600, lote: 50, cap: 400 },
    // 14. Footer (observador IN-F; o card nunca anima)
    { g: 'foot', foot: true, s: '.site-footer .footer__top', fx: 'up', d: 16, dur: 600 },
    { g: 'foot', foot: true, s: '.footer__nav > .footer__col, .footer__nav > .footer__contact', fx: 'up', d: 16, dur: 600, lote: 70 },
    { g: 'foot', foot: true, s: '.footer__bar', fx: 'fade', dur: 500 },
    { g: 'foot', foot: true, s: '.footer__pattern .dot-pattern', fx: 'wipe-x', dur: 900 },
    { g: 'foot', foot: true, s: '.footer__legal', fx: 'fade', dur: 500, at: 100, sentinel: true }
  ];

  function depEls(el, dp) {
    if (dp.get) return [dp.get(el)];
    if (dp.all) return $$(dp.all, el);
    return [el.querySelector(dp.s)];
  }

  /* ---------------------------------------------------------
     Disparo de lotes
     --------------------------------------------------------- */
  function settleRecord(r) {
    if (r.done) return;
    r.done = true;
    unobs(r);
    [r.el].concat(r.deps.map(function (x) { return x.el; })).forEach(function (el) {
      if (el.hasAttribute('data-anim')) { el.removeAttribute('data-anim'); el.classList.remove('is-in'); }
      pending.delete(el);
    });
    maybeCleanup();
  }

  function startRecord(r, D, ctx) {
    if (halt) { r.done = false; settleRecord(r); return; }
    try { startRecordRaw(r, D, ctx); } catch (err) { report(err); release(r); }
  }
  function startRecordRaw(r, D, ctx) {
    var e = r.e, k = 0, vr = null, fe = e;
    if (r.extra && e.dur) { fe = {}; for (var key in e) fe[key] = e[key]; fe.dur = e.dur + r.extra; }
    var tail = runFx(r.el, fe, D);
    r.deps.forEach(function (x) {
      var dp = x.e;
      if (dp.inView) {                           // posts: só os visíveis no trilho animam
        vr = vr || r.el.getBoundingClientRect();
        var pr = x.el.getBoundingClientRect();
        if (pr.right <= vr.left + 1 || pr.left >= vr.right - 1) { settle(x.el); return; }
        runFx(x.el, dp, D + (k++) * dp.inView);
        return;
      }
      var dd = dp.delay ? dp.delay({ D: D, li: ctx.li, ls: ctx.ls, tail: tail }) : D + (dp.at || 0);
      runFx(x.el, dp, dd);
    });
    // Dependentes não marcados (escala, contador) resolvidos no disparo
    (e.deps || []).forEach(function (dp) {
      if (MARKS[dp.fx]) return;
      if (dp.first && r.el.previousElementSibling) return;
      depEls(r.el, dp).forEach(function (x) { if (x) runFx(x, dp, D + (dp.at || 0)); });
    });
    if (e.fx === 'none') settle(r.el);
  }

  // Espera o load (nunca img.decode(): decodifica no tamanho intrínseco com outro
  // filtro e o raster final deixava de bater com o estático; ver ANIMACOES.md)
  function waitImg(img, cap) {
    if (!img || img.complete) return Promise.resolve();
    return Promise.race([new Promise(function (res) {
      img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true });
    }), wait(cap)]);
  }

  function fire(batch) {
    batch.forEach(function (r) { r.queued = false; });
    try { fireRaw(batch); } catch (err) {
      report(err);
      batch.forEach(function (r) { if (!r.started) release(r); });
    }
  }
  function fireRaw(batch) {
    if (!batch.length) return;
    batch.sort(function (a, b) { return a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1; });
    var now = performance.now(), base = Math.max(0, minStart - now), groups = {};
    var cols = w.matchMedia('(max-width: 720px)').matches ? 2 : 5;
    batch.forEach(function (r) { (groups[r.e.g] = groups[r.e.g] || []).push(r); });
    Object.keys(groups).forEach(function (g) {
      var list = groups[g], byE = new Map();
      list.forEach(function (r) { if (!byE.has(r.e)) byE.set(r.e, []); byE.get(r.e).push(r); });
      byE.forEach(function (rs, e) {
        var n = rs.length, ls = e.lote && n > 1 ? Math.min(e.lote, (e.cap || 450) / (n - 1)) : 0, minDiag = Infinity;
        if (e.diag) rs.forEach(function (r) {
          var li = r.el.closest('li'), i = Array.prototype.indexOf.call(li.parentNode.children, li);
          r.dg = Math.floor(i / cols) + (i % cols); minDiag = Math.min(minDiag, r.dg);
        });
        var maxRaw = 0;
        rs.forEach(function (r, i) {
          r.li = i; r.ls = ls;
          r.raw = (e.at || 0) + i * ls + (e.diag ? (r.dg - minDiag) * e.diag : 0);
          maxRaw = Math.max(maxRaw, r.raw);
        });
        // lite: escalonamento só no atraso; as durações se ajustam para todos terminarem
        // no mesmo quadro → as camadas são desmontadas uma vez, não dezenas
        if (lite && (e.lote || e.diag)) rs.forEach(function (r) { r.extra = maxRaw - r.raw; });
      });
      var minRaw = Math.min.apply(null, list.map(function (r) { return r.raw; }));
      list.forEach(function (r) {
        var D = r.raw - minRaw + base, e = r.e, ctx = { li: r.li, ls: r.ls };
        r.done = true; r.started = true;
        if (e.decode || e.load) {
          var img = e.load ? r.el : r.el.querySelector(e.decode);
          var go = function () { startRecord(r, D, ctx); };
          try { waitImg(img, e.load || 300).then(go, go); } catch (err) { report(err); go(); }
        } else startRecord(r, D, ctx);
      });
    });
  }

  // Sai do observador quando nenhum registro que depende daquele alvo está pendente
  function unobs(r) {
    if (!r.obs) return;
    var g = trig.get(r.oel);
    if (!g || g.every(function (x) { return x.done || x.queued; })) r.obs.unobserve(r.oel);
  }

  // Recuperação. Leituras primeiro, escritas depois (sem intercalar layout e DOM).
  // - acima da tela (pulado por âncora/salto): assenta na hora, sem animação;
  // - na faixa IN (na tela, topo acima de 88%): entra no lote e anima — cobre saltos
  //   instantâneos em que o observador de um alvo nunca viu a interseção;
  // - colegas de trecho (mates) que estão abaixo: entram no lote (o trecho dispara junto);
  // - sentinela (all): o que sobrar assenta.
  function catchUp(batch, all, mates) {
    var vh = w.innerHeight, band = vh * 0.88, list = [], rects = [];
    records.forEach(function (r) { if (!r.done && r.obs && !r.queued) list.push(r); });
    list.forEach(function (r) { rects.push(r.el.getBoundingClientRect()); });
    list.forEach(function (r, i) {
      var b = rects[i];
      if (r.done || r.queued) return;
      if (b.bottom < 0) { settleRecord(r); return; }
      var inBand = b.top < (all ? vh : band) && b.bottom > 0;
      if (inBand || mates.indexOf(r) >= 0) { r.queued = true; batch.push(r); unobs(r); }
      else if (all) settleRecord(r);
    });
  }

  function onIn(entries, obs) {
    var batch = [];
    try { onInRaw(entries, obs, batch); } catch (err) {
      report(err);
      batch.forEach(function (r) { if (!r.started) release(r); });
    }
  }
  function onInRaw(entries, obs, batch) {
    var sentinel = false, mates = [];
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      obs.unobserve(en.target);
      (trig.get(en.target) || []).forEach(function (r) {
        if (r.done || r.queued) return;
        r.queued = true; batch.push(r); if (r.e.sentinel) sentinel = true;
        (r.chunk || []).forEach(function (m) { if (!m.done && !m.queued && mates.indexOf(m) < 0) mates.push(m); });
      });
    });
    if (!batch.length) return;                   // callback vazio (ex.: o inicial): nada a medir
    catchUp(batch, sentinel, mates);
    batch.forEach(function (r) { r.queued = false; });
    fire(batch);
  }

  /* Foco por teclado nunca cai em conteúdo ainda invisível (WCAG 2.4.7):
     o registro que contém o alvo assenta na hora, sem animação. */
  function onFocus(ev) {
    var hit = [];
    for (var n = ev.target; n && n.nodeType === 1; n = n.parentNode) {
      var r = recOf.get(n) || depOf.get(n);
      if (r && !r.done && hit.indexOf(r) < 0) hit.push(r);
    }
    hit.forEach(function (r) { try { settleRecord(r); } catch (err) { report(err); hardStop(); } });
  }

  /* ---------------------------------------------------------
     Limpeza final (§7.8) e parada geral
     --------------------------------------------------------- */
  function maybeCleanup() {
    if (!booted || cleaned || pending.size || running.size || busy || splits.size || counters.size || !heroDone) return;
    cleaned = true;
    html.classList.remove('js-anim', 'anim-ready', 'hero-anim');
    heroEls.forEach(function (el) { el.classList.remove('is-in'); });
    [ioIn, ioFoot, ioPre].forEach(function (o) { if (o) o.disconnect(); });
    w.removeEventListener('resize', onResize);
    w.removeEventListener('beforeprint', finishAll);
    d.removeEventListener('focusin', onFocus, true);
    if (audit) setTimeout(runAudit, 50);
  }

  function finishAll() {
    halt = true;
    running.forEach(function (a) { try { a.finish(); } catch (e) {} });
    counters.forEach(function (end) { end(); });
    records.forEach(function (r) { settleRecord(r); });
    heroEls.forEach(function (el) { el.classList.add('is-in'); });
    heroLeft = 0; heroDone = true;
    maybeCleanup();
  }

  function onResize() {
    if (w.innerWidth === lastW) return;
    lastW = w.innerWidth;
    splits.forEach(function (sp) { sp.anims.forEach(function (a) { try { a.finish(); } catch (e) {} }); });
  }

  /* ---------------------------------------------------------
     Hero: timeline de carga (§8.2)
     --------------------------------------------------------- */
  function heroTimeline(bootAt, heroBottom) {
    var q = function (s) { return d.querySelector(s); };
    var items = [
      { el: q('.hero__eyebrow'), at: 0, d: 12, dur: 600 },
      { el: q('.hero .t-display'), at: 80, lines: true },
      { el: q('.hero__desc'), at: 320, d: 16, dur: 700 },
      { el: q('.hero__actions .btn--primary'), at: 440, d: 16, dur: 700 },
      { el: q('.hero__actions .btn--glass'), at: 520, d: 16, dur: 700 }
    ].filter(function (it) { return it.el; });
    heroEls = $$('.hero__eyebrow, .hero .t-display, .hero__desc, .hero__actions .btn');
    var hero = q('.hero');
    var finishStatic = function () { heroEls.forEach(function (el) { el.classList.add('is-in'); }); heroDone = true; };
    // Sem html.hero-anim (lite, ou o timer do gate venceu os 1400 ms) o hero nunca foi escondido
    if (!items.length || bootAt > 1400 || !hero || heroBottom <= 0 || !html.classList.contains('hero-anim')) { finishStatic(); return; }
    heroDone = false; heroLeft = items.length;
    var after = function () { if (--heroLeft <= 0) { heroDone = true; maybeCleanup(); } };
    var go = function () {
      if (heroDone) return;
      if (halt) { finishStatic(); maybeCleanup(); return; }
      minStart = performance.now() + 500;        // nada abaixo da dobra antes de T0 + 500
      try {
        items.forEach(function (it) {
          if (it.lines) runLines(it.el, it.at, { dur: 950 }, after);
          else play(it.el, UP(dist(it.d)), { dur: it.dur, delay: it.at, after: after });
        });
      } catch (err) { report(err); finishStatic(); maybeCleanup(); }
    };
    if (bootAt > 1000 || !d.fonts || !d.fonts.load) { go(); return; }
    Promise.race([d.fonts.load('300 64px "Stack Sans Headline"'), wait(300)]).then(go, go);
  }

  /* ---------------------------------------------------------
     Auditoria (?anim-audit, só desenvolvimento) — §14
     --------------------------------------------------------- */
  function runAudit() {
    var rows = [], res = {};
    var check = function (name, ok, info) { rows.push({ asserção: name, ok: !!ok, info: info || '' }); };
    check('html sem js-anim/anim-ready', !html.classList.contains('js-anim') && !html.classList.contains('anim-ready'), html.className);
    var left = $$('[data-anim], .is-in, .ln, .ln__in, .a-clip, .a-enter');
    check('sem marcas temporárias', !left.length, left.length);
    var an = d.getAnimations ? d.getAnimations().filter(function (a) { return a.id && a.id.indexOf('a-') === 0; }) : [];
    check('sem animações a-*', !an.length, an.length);
    var arts = $$('.cta-box__art, .step__art, .faq__art');
    check('8 ilustrações são <img>', arts.length === 8 && arts.every(function (e) { return e.tagName === 'IMG'; }), arts.length);
    check('sem svg com sufixo -a{n}', !$$('svg [id]').some(function (e) { return /-a\d+$/.test(e.id); }));
    var diffs = [];
    snap.forEach(function (v, el) {
      if (!el.isConnected || el.classList.contains('blog__track')) return;
      if (el.getAttribute('style') !== v) diffs.push((el.id || el.className || el.tagName) + ': ' + v + ' → ' + el.getAttribute('style'));
    });
    check('atributos style idênticos ao boot', !diffs.length, diffs.join(' | '));
    var titles = $$('.hero .t-display, #property-title, #docs-title, #method-title, #about-title, .about__profile > .t-h2, #cases-title, #blog-title, #faq-title');
    check('títulos com um único nó Text', titles.every(function (t) { return t.childNodes.length === 1 && t.firstChild.nodeType === 3; }));
    var st = d.querySelector('.stats > .stat:first-child > strong');
    check('contador restaurado', st && st.textContent === '+20 anos' && !st.hasAttribute('aria-hidden') && !st.parentNode.querySelector('.sr-only'), st && st.textContent);
    var wc = $$('*').filter(function (e) { return getComputedStyle(e).willChange !== 'auto'; });
    check('sem will-change', !wc.length, wc.length);
    var stuck = $$('body *').filter(function (e) {
      var cs = getComputedStyle(e);
      return (cs.translate && cs.translate !== 'none') || (cs.scale && cs.scale !== 'none') ||
        (cs.clipPath !== 'none') || (cs.opacity === '0' && !e.closest('.testimonial, .docs__art, .about__slides, .doc__head, .nav'));
    });
    check('sem translate/scale/clip-path/opacity residual', !stuck.length, stuck.slice(0, 5).map(function (e) { return e.className; }).join(', '));
    check('sem erros em tempo de execução', !faults, faults);
    check('sem scroll horizontal', html.scrollWidth === html.clientWidth, html.scrollWidth + '/' + html.clientWidth);
    rows.forEach(function (r) { res[r.asserção] = r.ok; });
    w.__animAudit = rows;
    var bad = rows.filter(function (r) { return !r.ok; }).map(function (r) { return r.asserção + ' [' + r.info + ']'; });
    html.setAttribute('data-anim-audit', bad.length ? 'falhou: ' + bad.join(' ; ') : 'ok');
    if (w.console && console.table) console.table(rows);
  }

  /* ---------------------------------------------------------
     Boot (§7.3): uma única tarefa síncrona
     --------------------------------------------------------- */
  try {
    var now = performance.now();
    lite = w.matchMedia('(max-width: 960px)').matches || (navigator.hardwareConcurrency || 8) <= 4 ||
      !!(navigator.connection && navigator.connection.saveData);
    small = w.matchMedia('(max-width: 720px)').matches;
    audit = /[?&]anim-audit\b/.test(location.search);
    if (audit) { snap = new Map(); $$('*').forEach(function (el) { snap.set(el, el.getAttribute('style')); }); }
    minStart = now + 500;

    // Registro
    SPEC.forEach(function (e) {
      if (e.when && !e.when()) return;
      $$(e.s).forEach(function (el) {
        if (recOf.has(el)) return;
        var r = { el: el, e: e, deps: [], done: false, obs: null };
        (e.deps || []).forEach(function (dp) {
          if (!MARKS[dp.fx]) return;                 // escala/contador: resolvidos no disparo
          depEls(el, dp).forEach(function (x) { if (x) { r.deps.push({ el: x, e: dp }); depOf.set(x, r); } });
        });
        records.push(r); recOf.set(el, r);
      });
    });

    // Fase de leitura
    var vh = w.innerHeight;
    var heroEl = d.querySelector('.hero'), heroBottom = heroEl ? heroEl.getBoundingClientRect().bottom : 0;
    var reads = records.map(function (r) {
      var top = r.el.getBoundingClientRect().top;
      return {
        top: top,
        below: top >= vh,
        vis: r.el.getClientRects().length > 0,
        deps: r.deps.map(function (x) { return x.el.getClientRects().length > 0; })
      };
    });

    // Fase de escrita: só o que está inteiramente abaixo da dobra e visível
    var marked = [];
    records.forEach(function (r, i) {
      var rd = reads[i];
      if (!rd.below || !rd.vis) { r.done = true; return; }
      r.top = rd.top;
      r.deps = r.deps.filter(function (x, j) { return rd.deps[j]; });
      if (MARKS[r.e.fx]) r.el.setAttribute('data-anim', r.e.fx);
      pending.add(r.el);
      r.deps.forEach(function (x) { x.el.setAttribute('data-anim', x.e.fx); pending.add(x.el); });
      marked.push(r);
    });
    records = marked;

    // Hero
    heroTimeline(now, heroBottom);

    // Observadores
    ioIn = new IntersectionObserver(onIn, { rootMargin: '0px 0px -12% 0px', threshold: 0 });
    ioFoot = new IntersectionObserver(onIn, { rootMargin: '0px', threshold: 0 });
    ioPre = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        ioPre.unobserve(en.target);
        getSvg(en.target.currentSrc || en.target.src);
      });
    }, { rootMargin: '800px 0px' });
    // Todo alvo marcado é observado (salto instantâneo nunca deixa item sem gatilho).
    // Listas escalonadas (lote/diag) formam trechos de meia tela: quando um item do
    // trecho dispara, os colegas pendentes entram no mesmo lote (o escalonamento vem do lote).
    // wipe-y começa com clip-path de altura 0 e o IO usa a caixa recortada → observa o pai.
    var chunk = null;
    records.forEach(function (r) {
      r.obs = r.e.foot ? ioFoot : ioIn;
      r.oel = r.e.fx === 'wipe-y' ? r.el.parentElement : r.el;
      var par = (r.e.lote || r.e.diag) ? (r.e.diag ? r.el.closest('ul, ol') : r.el.parentElement) : null;
      if (par && chunk && chunk.e === r.e && chunk.par === par && r.top - chunk.top < vh * 0.5) {
        chunk.list.push(r);
      } else {
        chunk = par ? { e: r.e, par: par, top: r.top, list: [r] } : null;
      }
      if (chunk) r.chunk = chunk.list;
      trig.set(r.oel, (trig.get(r.oel) || []).concat([r]));
      r.obs.observe(r.oel);
      if (!lite) r.deps.forEach(function (x) { if (x.e.fx === 'draw') ioPre.observe(x.el); });
    });
    d.addEventListener('focusin', onFocus, true);

    w.addEventListener('resize', onResize, { passive: true });
    w.addEventListener('beforeprint', finishAll);

    html.classList.add('anim-ready');            // por último
    booted = true;
    maybeCleanup();
  } catch (err) {
    html.classList.remove('js-anim', 'anim-ready', 'hero-anim');
    if (w.console) console.error('[animations]', err);
  }
})();
