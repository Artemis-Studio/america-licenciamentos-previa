/* Posição da navegação por nichos abaixo do cabeçalho. */
(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var navigation = document.querySelector('.clients-niches-bar');
  if (!header || !navigation) return;

  var filters = navigation.querySelector('.clients-niches');
  var controls = navigation.querySelector('.clients-niches-controls');
  var previous = navigation.querySelector('[data-niches-previous]');
  var next = navigation.querySelector('[data-niches-next]');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function updateControls() {
    var canGoBack = filters.scrollLeft > 1;
    var canGoForward = filters.scrollLeft < filters.scrollWidth - filters.clientWidth - 1;
    previous.disabled = !canGoBack;
    next.disabled = !canGoForward;
    controls.classList.toggle('has-previous', canGoBack);
    controls.classList.toggle('has-next', canGoForward);
  }

  function updateOffsets() {
    document.body.style.setProperty('--clients-header-height', header.getBoundingClientRect().height + 'px');
    document.body.style.setProperty('--clients-niches-height', navigation.getBoundingClientRect().height + 'px');
    updateControls();
  }

  function moveFilters(direction) {
    filters.scrollBy({
      left: direction * Math.max(160, filters.clientWidth * .7),
      behavior: reducedMotion.matches ? 'auto' : 'smooth'
    });
  }

  previous.addEventListener('click', function () { moveFilters(-1); });
  next.addEventListener('click', function () { moveFilters(1); });
  filters.addEventListener('scroll', updateControls, { passive: true });
  updateOffsets();
  if ('ResizeObserver' in window) {
    var observer = new ResizeObserver(updateOffsets);
    observer.observe(header);
    observer.observe(navigation);
    observer.observe(filters);
  } else {
    window.addEventListener('resize', updateOffsets);
  }
  if (document.fonts) document.fonts.ready.then(updateControls);
})();

/* Depoimentos: um vídeo por vez, sem som e somente enquanto estiver visível. */
(function () {
  'use strict';

  if (window.location.protocol === 'file:' || !('IntersectionObserver' in window)) return;

  var videos = Array.from(document.querySelectorAll('.clients-videos .health__video')).map(function (box) {
    var link = box.querySelector('a');
    var match = link && new URL(link.href).pathname.match(/^\/shorts\/([\w-]{11})$/);
    if (!match) return null;
    return { box: box, link: link, id: match[1], visible: false, ready: false, paused: false, ended: false };
  }).filter(Boolean);
  if (!videos.length) return;

  var active = null;
  var apiReady;
  var observer;

  function loadAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiReady) return apiReady;
    apiReady = new Promise(function (resolve, reject) {
      var previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof previousReady === 'function') previousReady();
        resolve();
      };
      var script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('error', reject, { once: true });
    });
    return apiReady;
  }

  function pauseOthers(selected) {
    videos.forEach(function (video) {
      if (video === selected || !video.ready || video.failed) return;
      var state = video.player.getPlayerState();
      if (state === window.YT.PlayerState.PLAYING || state === window.YT.PlayerState.BUFFERING) {
        video.programmaticPause = true;
        video.player.pauseVideo();
      }
    });
  }

  function restoreLink(video) {
    video.failed = true;
    video.ready = false;
    if (active === video) active = null;
    if (video.player) video.player.destroy();
    video.box.replaceChildren(video.link);
    syncPlayback();
  }

  function mountPlayer(video) {
    if (video.loading) return;
    video.loading = true;
    loadAPI().then(function () {
      video.loading = false;
      if (active !== video || !video.visible || document.hidden) return;

      var frame = document.createElement('iframe');
      frame.title = video.link.getAttribute('aria-label').replace('Assistir ao ', '').replace(' no YouTube', '');
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = 'https://www.youtube.com/embed/' + video.id +
        '?enablejsapi=1&playsinline=1&rel=0&origin=' + encodeURIComponent(window.location.origin);
      video.box.replaceChildren(frame);
      video.loading = true;
      video.player = new window.YT.Player(frame, {
        events: {
          onReady: function (event) {
            video.loading = false;
            video.ready = true;
            event.target.mute();
            syncPlayback();
          },
          onStateChange: function (event) {
            if (video.failed) return;
            if (event.data === window.YT.PlayerState.PLAYING) {
              active = video;
              video.paused = false;
              video.ended = false;
              pauseOthers(video);
              if (document.hidden || !video.visible) syncPlayback();
            } else if (event.data === window.YT.PlayerState.ENDED) {
              video.ended = true;
              if (active === video) active = null;
              syncPlayback();
            } else if (event.data === window.YT.PlayerState.PAUSED && video.programmaticPause) {
              video.programmaticPause = false;
            } else if (event.data === window.YT.PlayerState.PAUSED && active === video) {
              // Uma pausa pelos controles permanece até o vídeo sair da tela.
              video.paused = true;
              active = null;
            }
          },
          onAutoplayBlocked: function () {
            video.paused = true;
            if (active === video) active = null;
          },
          onError: function () { restoreLink(video); }
        }
      });
    }).catch(function () { restoreLink(video); });
  }

  function eligible(video) {
    return video.visible && !video.failed && !video.paused && !video.ended;
  }

  function syncPlayback() {
    var selected = document.hidden ? null : (active && eligible(active) ? active : videos.find(eligible));
    active = selected;
    pauseOthers(selected);
    if (!selected) return;
    if (!selected.ready) {
      mountPlayer(selected);
      return;
    }
    var state = selected.player.getPlayerState();
    if (state !== window.YT.PlayerState.PLAYING && state !== window.YT.PlayerState.BUFFERING) {
      selected.player.mute();
      selected.player.playVideo();
    }
  }

  function observeVideos() {
    if (observer) observer.disconnect();
    var header = document.querySelector('.site-header');
    var navigation = document.querySelector('.clients-niches-bar');
    var top = (header ? header.getBoundingClientRect().height : 0) +
      (navigation ? navigation.getBoundingClientRect().height : 0);
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var video = videos.find(function (item) { return item.box === entry.target; });
        video.visible = entry.intersectionRatio >= .6;
        if (!video.visible) video.paused = false;
      });
      syncPlayback();
    }, { rootMargin: '-' + top + 'px 0px 0px', threshold: [0, .6] });
    videos.forEach(function (video) { observer.observe(video.box); });
  }

  observeVideos();
  window.addEventListener('resize', observeVideos);
  document.addEventListener('visibilitychange', syncPlayback);
})();
