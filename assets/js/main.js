/* América Licenciamentos — interações da home */
(function () {
  'use strict';

  /* Menu mobile */
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  if (header && toggle) {
    function setMenuOpen(open) {
      header.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    }

    toggle.addEventListener('click', function () {
      setMenuOpen(!header.classList.contains('is-open'));
    });
    header.querySelectorAll('.nav a').forEach(function (a) {
      a.addEventListener('click', function () { setMenuOpen(false); });
    });
  }

  /* Documentos: abas em acordeão + troca da ilustração */
  // Corpo recolhido de acordeão não recebe foco (os links "Ver …" eram paradas de Tab invisíveis)
  function setInert(el, on) { if (el) el.inert = on; }

  function setupDocuments() {
    var docList = document.querySelector('[data-docs]');
    if (!docList) return;
    var items = Array.from(docList.querySelectorAll('.doc'));
    if (!items.length) return;

    var heads = items.map(function (item) { return item.querySelector('.doc__head'); });
    var bodies = items.map(function (item) { return item.querySelector('.doc__body'); });
    var images = document.querySelectorAll('[data-docs-art] img');
    var active = Math.max(0, items.findIndex(function (item) { return item.classList.contains('is-active'); }));

    function setOpen(index, on) {
      items[index].classList.toggle('is-active', on);
      heads[index].setAttribute('aria-expanded', String(on));
      setInert(bodies[index], !on);
    }

    function updateArt() {
      images.forEach(function (img) {
        var on = img.dataset.doc === items[active].dataset.doc;
        img.classList.toggle('is-active', on);
        img.setAttribute('aria-hidden', String(!on));
      });
    }

    function activateDocument(index) {
      if (index < 0 || index === active) return;
      setOpen(active, false);
      active = index;
      setOpen(active, true);
      updateArt();
      docList.dispatchEvent(new Event('docs:manual-change'));
    }

    function activateFromFragment(fragment) {
      activateDocument(heads.findIndex(function (head) { return head.id && '#' + head.id === fragment; }));
    }

    items.forEach(function (item, index) { setOpen(index, index === active); });
    updateArt();
    docList.addEventListener('click', function (event) {
      activateDocument(heads.indexOf(event.target.closest('.doc__head')));
    });

    var healthLink = document.querySelector('.docs__paths a[href="#licenca-sanitaria"]');
    if (healthLink) {
      healthLink.addEventListener('click', function (event) {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        activateFromFragment(healthLink.hash);
      });
      window.addEventListener('hashchange', function () { activateFromFragment(window.location.hash); });
      activateFromFragment(window.location.hash);
    }
  }

  setupDocuments();

  function setupAccountantsVideo() {
    var box = document.querySelector('[data-testimonial-player]');
    if (!box || !('IntersectionObserver' in window)) return;

    var link = box.querySelector('[data-testimonial-link]');
    if (!link) return;
    var source = new URL(link.href);
    var host = source.hostname.replace(/^(www|m)\./, '');
    var id = '';
    if (host === 'youtu.be') {
      id = source.pathname.split('/')[1];
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      var path = source.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
      id = path ? path[1] : source.searchParams.get('v');
    }
    if (!/^[\w-]{11}$/.test(id || '')) return;

    var frame, player, visible = false;
    var observer = new IntersectionObserver(function (entries) {
      visible = entries[0].intersectionRatio >= 0.6;
      startWhenVisible();
    }, { threshold: 0.6 });

    function startWhenVisible() {
      if (!visible || document.hidden) return;
      if (!frame) mountPlayer();
      if (!player) return;

      observer.disconnect();
      document.removeEventListener('visibilitychange', startWhenVisible);
      var state = player.getPlayerState();
      if (state !== window.YT.PlayerState.PLAYING && state !== window.YT.PlayerState.BUFFERING) {
        player.mute();
        player.playVideo();
      }
    }

    function mountPlayer() {
      frame = document.createElement('iframe');
      frame.title = box.dataset.testimonialPlayer;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = 'https://www.youtube.com/embed/' + id +
        '?enablejsapi=1&playsinline=1&rel=0&origin=' + encodeURIComponent(window.location.origin);
      box.replaceChildren(frame);

      function connectPlayer() {
        new window.YT.Player(frame, {
          events: { onReady: function (event) {
            player = event.target;
            startWhenVisible();
          } }
        });
      }

      if (window.YT && window.YT.Player) {
        connectPlayer();
        return;
      }

      var previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        window.onYouTubeIframeAPIReady = previousReady;
        if (typeof previousReady === 'function') previousReady();
        connectPlayer();
      };

      var apiUrl = 'https://www.youtube.com/iframe_api';
      if (!document.querySelector('script[src="' + apiUrl + '"]')) {
        var script = document.createElement('script');
        script.src = apiUrl;
        document.head.appendChild(script);
      }
    }

    observer.observe(box);
    document.addEventListener('visibilitychange', startWhenVisible);
  }

  setupAccountantsVideo();

  /* FAQ: acordeão (um aberto por vez) */
  var faq = document.querySelector('[data-faq]');
  if (faq) {
    faq.querySelectorAll('.faq-item').forEach(function (i) { setInert(i.querySelector('.faq-item__a'), !i.classList.contains('is-open')); });
    faq.addEventListener('click', function (e) {
      var q = e.target.closest('.faq-item__q');
      if (!q) return;
      var item = q.closest('.faq-item');
      var willOpen = !item.classList.contains('is-open');
      faq.querySelectorAll('.faq-item').forEach(function (i) {
        i.classList.remove('is-open');
        i.querySelector('.faq-item__q').setAttribute('aria-expanded', 'false');
        setInert(i.querySelector('.faq-item__a'), true);
      });
      if (willOpen) { item.classList.add('is-open'); q.setAttribute('aria-expanded', 'true'); setInert(item.querySelector('.faq-item__a'), false); }
    });
  }

  /* Quem faz: troca suave das fotos da equipe */
  // Só troca com a seção na tela e a aba visível (nada de trabalho fora da vista)
  var mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-fade]').forEach(function (box) {
    var imgs = box.querySelectorAll('img');
    if (imgs.length < 2 || mqReduce.matches) return;
    var i = 0, timer = null, inView = !('IntersectionObserver' in window);
    var tick = function () {
      if (mqReduce.matches) return;
      imgs[i].classList.remove('is-active');
      i = (i + 1) % imgs.length;
      imgs[i].classList.add('is-active');
    };
    var sync = function () {
      var run = inView && !document.hidden;
      if (run && !timer) timer = setInterval(tick, 5000);
      else if (!run && timer) { clearInterval(timer); timer = null; }
    };
    if (!inView) new IntersectionObserver(function (en) { inView = en[0].isIntersecting; sync(); }).observe(box);
    document.addEventListener('visibilitychange', sync);
    sync();
  });

  /* Sliders (depoimentos = fade; blog = trilho horizontal) */
  function buildDots(wrap, count, go) {
    wrap.innerHTML = '';
    var dots = [];
    for (var k = 0; k < count; k++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Ir para ' + (k + 1));
      b.addEventListener('click', go.bind(null, k));
      wrap.appendChild(b);
      dots.push(b);
    }
    return dots;
  }

  // Repete os posts para preencher o trilho do blog.
  function fill(track, selector, min) {
    var items = track.querySelectorAll(selector);
    var n = items.length, k = 0;
    while (track.querySelectorAll(selector).length < min && n) {
      var c = items[k % n].cloneNode(true);
      c.classList.remove('is-active');
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
      k++;
    }
  }

  var t = document.querySelector('[data-slider="testimonials"]');
  var slides = t && t.querySelectorAll('.testimonial');
  if (slides && slides.length > 1) {
    var cur = 0, dotsT;
    var goT = function (i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, j) {
        var active = j === cur;
        s.classList.toggle('is-active', active);
        s.toggleAttribute('inert', !active);
        if (active) s.removeAttribute('aria-hidden');
        else s.setAttribute('aria-hidden', 'true');
      });
      dotsT.forEach(function (d, j) { d.setAttribute('aria-current', String(j === cur)); });
    };
    dotsT = buildDots(t.querySelector('[data-dots]'), slides.length, goT);
    t.querySelector('[data-prev]').addEventListener('click', function () { goT(cur - 1); });
    t.querySelector('[data-next]').addEventListener('click', function () { goT(cur + 1); });
    goT(0);
  }

  var b = document.querySelector('[data-slider="blog"]');
  if (b) {
    var bTrack = b.querySelector('[data-track]');
    fill(bTrack, '.post', 7);
    var posts = bTrack.querySelectorAll('.post');
    var pos = 0, dotsB = [];
    var visible = function () {
      var w = bTrack.parentElement.clientWidth, pw = posts[0].getBoundingClientRect().width;
      return Math.max(1, Math.round((w + 24) / (pw + 24)));
    };
    var pages = function () { return Math.max(1, posts.length - visible() + 1); };
    var goB = function (i) {
      var p = pages(), vis = visible();
      pos = (i + p) % p;
      var step = posts[0].getBoundingClientRect().width + 24;
      bTrack.style.transform = 'translateX(' + (-pos * step) + 'px)';
      dotsB.forEach(function (d, j) { d.setAttribute('aria-current', String(j === pos)); });
      // Só os posts da página visível recebem foco/leitor de tela (cópias e posts fora da
      // janela ficam inert): o Tab nunca cai em conteúdo escondido nem rola o viewport.
      posts.forEach(function (post, j) {
        var on = j >= pos && j < pos + vis;
        if (on) { post.removeAttribute('inert'); post.removeAttribute('aria-hidden'); }
        else { post.setAttribute('inert', ''); post.setAttribute('aria-hidden', 'true'); }
      });
    };
    // O viewport é overflow:hidden; se algo o rolar (foco, busca na página), volta ao 0
    // para o transform e os pontos continuarem valendo.
    var bView = bTrack.parentElement;
    bView.addEventListener('scroll', function () { if (bView.scrollLeft) bView.scrollLeft = 0; }, { passive: true });
    var rebuild = function () { dotsB = buildDots(b.querySelector('[data-dots]'), pages(), goB); goB(Math.min(pos, pages() - 1)); };
    b.querySelector('[data-prev]').addEventListener('click', function () { goB(pos - 1); });
    b.querySelector('[data-next]').addEventListener('click', function () { goB(pos + 1); });
    rebuild();
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(rebuild, 150); });
  }
})();
