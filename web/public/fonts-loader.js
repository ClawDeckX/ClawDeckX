/**
 * Smart Font Loader - Auto-detects fastest CDN for international and China users
 * Tries multiple CDN sources in parallel and uses the fastest one
 */
(function() {
  const FONTS = [
    'family=Inter:wght@100;300;400;500;600;700;800;900',
    'family=Material+Symbols+Outlined:wght,FILL@100..700,0..1',
    'family=JetBrains+Mono:wght@400;500'
  ];

  const CDN_SOURCES = [
    {
      name: 'Google Fonts',
      base: 'https://fonts.googleapis.com/css2',
      priority: 1
    },
    {
      name: 'fonts.loli.net (China Mirror)',
      base: 'https://fonts.loli.net/css2',
      priority: 2
    },
    {
      name: 'fonts.geekzu.org (China Mirror)',
      base: 'https://fonts.geekzu.org/css2',
      priority: 3
    }
  ];

  let fontsLoaded = false;

  // Load fonts from a specific CDN
  function loadFonts(cdnBase, sourceName) {
    if (fontsLoaded) return;
    fontsLoaded = true;

    const params = FONTS.join('&') + '&display=swap';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${cdnBase}?${params}`;
    link.onerror = () => {
      console.warn(`[Fonts] Failed to load from ${sourceName}`);
    };
    link.onload = () => {
      console.log(`[Fonts] Successfully loaded from ${sourceName}`);
    };
    document.head.appendChild(link);
  }

  // Race: try all CDNs and use the first one that responds
  function loadFontsWithRace() {
    const testPromises = CDN_SOURCES.map(source => {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const testUrl = `${source.base}?family=Inter:wght@400&display=swap`;
        
        // Use a lightweight test request
        fetch(testUrl, { 
          method: 'GET',
          cache: 'no-cache',
          signal: AbortSignal.timeout(3000)
        })
          .then(response => {
            if (response.ok) {
              const loadTime = Date.now() - startTime;
              resolve({ source, loadTime, success: true });
            } else {
              resolve({ source, success: false });
            }
          })
          .catch(() => {
            resolve({ source, success: false });
          });
      });
    });

    // Wait for all tests to complete or timeout
    Promise.race(
      testPromises.map(p => p.then(result => {
        if (result.success) return result;
        return new Promise(() => {}); // Never resolve if failed
      }))
    ).then(winner => {
      if (winner) {
        console.log(`[Fonts] ${winner.source.name} responded in ${winner.loadTime}ms`);
        loadFonts(winner.source.base, winner.source.name);
      }
    }).catch(() => {
      // If race fails, fall back to priority order
      console.warn('[Fonts] Race failed, using priority fallback');
      loadFonts(CDN_SOURCES[0].base, CDN_SOURCES[0].name);
    });

    // Fallback timeout: if nothing loads in 5 seconds, use Google Fonts
    setTimeout(() => {
      if (!fontsLoaded) {
        console.warn('[Fonts] Timeout reached, using Google Fonts fallback');
        loadFonts(CDN_SOURCES[0].base, CDN_SOURCES[0].name);
      }
    }, 5000);
  }

  // Start loading fonts
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFontsWithRace);
  } else {
    loadFontsWithRace();
  }
})();
