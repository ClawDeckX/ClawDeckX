/**
 * Font loader with progressive fallback:
 * 1) start primary CDN immediately
 * 2) if not loaded quickly, try mirrors
 */
(function () {
  const params = [
    'family=Inter:wght@100;300;400;500;600;700;800;900',
    'family=JetBrains+Mono:wght@400;500',
    'display=swap',
  ].join('&');

  const sources = [
    { name: 'Google Fonts', base: 'https://fonts.googleapis.com/css2' },
    { name: 'fonts.loli.net', base: 'https://fonts.loli.net/css2' },
    { name: 'fonts.geekzu.org', base: 'https://fonts.geekzu.org/css2' },
  ];

  let stylesheetLoaded = false;

  function preconnect(url) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = url;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }

  function loadSource(source) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${source.base}?${params}`;
      link.onload = () => resolve(source);
      link.onerror = () => reject(new Error(`font source failed: ${source.name}`));
      document.head.appendChild(link);
    });
  }

  async function run() {
    preconnect('https://fonts.googleapis.com');
    preconnect('https://fonts.gstatic.com');
    preconnect('https://fonts.loli.net');
    preconnect('https://fonts.geekzu.org');

    // Start primary immediately.
    loadSource(sources[0]).then(() => {
      if (!stylesheetLoaded) {
        stylesheetLoaded = true;
      }
    }).catch(() => {});

    // Fallback chain with short delays.
    setTimeout(() => {
      if (stylesheetLoaded) return;
      loadSource(sources[1]).then(() => {
        if (!stylesheetLoaded) {
          stylesheetLoaded = true;
        }
      }).catch(() => {});
    }, 800);

    setTimeout(() => {
      if (stylesheetLoaded) return;
      loadSource(sources[2]).then(() => {
        if (!stylesheetLoaded) {
          stylesheetLoaded = true;
        }
      }).catch(() => {});
    }, 1600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
