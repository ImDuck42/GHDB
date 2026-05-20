export async function checkForUpdate(DATABASE_VERSION) {
  const isNewerVersion = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
      if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
    }

    return false;
  };

  const localStorageGet = key => { try { return localStorage.getItem(key) } catch { return null } }
  const localStorageSet = (key, val) => { try { localStorage.setItem(key, val) } catch {} }

  try {
    const scriptText = await fetch(
      new URL('./../github-db.js', import.meta.url)
    ).then(r => r.text());

    const latestVersion = scriptText.match(
      /DATABASE_VERSION\s*=\s*['"]([^'"]+)/
    )?.[1];

    if (!latestVersion || !isNewerVersion(latestVersion, DATABASE_VERSION))
      return console.log(`GHDB up to date (${DATABASE_VERSION})`);

    const changelogText = await fetch(
      new URL('./../CHANGELOG.md', import.meta.url)
    ).then(r => r.text());

    const relevantEntries = changelogText
      .split(/^(?=\[[\d.]+\])/m)
      .map(chunk => {
        const match = chunk.match(/^\[([\d.]+)\]([\s\S]*)/);
        return match
          ? { version: match[1], body: match[2].trim() }
          : null;
      })
      .filter(entry =>
        entry && isNewerVersion(entry.version, DATABASE_VERSION)
      )
      .map(({ version, body }) => `[${version}]\n${body}`)
      .join('\n\n');

    if (!relevantEntries)
      return console.log(`GHDB up to date (${DATABASE_VERSION})`);

    const versionTags = relevantEntries.match(/\[[\d.]+\]/g) ?? [];
    const formattedEntries = versionTags.reduce((acc, tag) => {
      return acc.replace(tag, `%c${tag}%c`);
    }, relevantEntries);

    console.log(
      `%cGHDB Update available! %c${DATABASE_VERSION} >> ${latestVersion}%c\n=> https://github.com/ImDuck42/GHDB\n\n${formattedEntries}\n`,

      'font-weight: bold', 'color: #888;',
      'color: inherit; font-weight: normal;',
      ...versionTags.flatMap(() => [
        'font-weight: bold; color: #ddd;',
        'color: inherit; font-weight: normal;',
      ]),
    );

    const suppressKey = `suppressUpdatePopup_${latestVersion}`

    if (localStorageGet(suppressKey) === 'true')
      return;

    const showPopup = () => {
      const popup = Object.assign(document.createElement('div'), {
        innerHTML: `
          <strong>GHDB Update available: v${latestVersion}</strong>
          <p>Check the console for changes.</p>
          <button id="update-popup-close">Close</button>
          <button id="update-popup-suppress">Don't show again</button>
        `
      });

      Object.assign(popup.style, {
          all:       'initial',
          inset:     'auto 10px 10px auto',
          display:   'block',
          position:  'fixed',
          boxSizing: 'content-box',

          zIndex:       '99999',
          background:   '#f9e2af',
          color:        '#11111b',
          border:       '1px solid #11111b',
          borderRadius: '5px',
          maxWidth:     '250px',
          padding:      '10px',
          fontFamily:   'sans-serif',
          fontSize:     '15px',
          lineHeight:   '1.8',
      });

      const buttons = popup.querySelectorAll('button');
      buttons.forEach(btn => {
          Object.assign(btn.style, {
              all:          'initial',
              display:      'inline-block',
              cursor:       'pointer',
              padding:      '5px 10px',
              marginRight:  '5px',
              border:       '1px solid #11111b',
              borderRadius: '5px',
              background:   '#f5d180',
          });
      });

      document.body.appendChild(popup);

      const closeBtn    = popup.querySelector('#update-popup-close');
      const suppressBtn = popup.querySelector('#update-popup-suppress');

      closeBtn.addEventListener('click', () => {
        popup.remove();
      }, { once: true });

      suppressBtn.addEventListener('click', () => {
        try {
          Object.keys(localStorage)
            .filter(key => key.startsWith('suppressUpdatePopup_'))
            .forEach(key => localStorage.removeItem(key))
        } catch {}
        localStorageSet(suppressKey, 'true');
        popup.remove();
      }, { once: true });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showPopup);
    } else {
      showPopup();
    }

    return { updated: false, latestVersion };

  } catch (err) {
    console.error('Update check failed:', err);
    return { updated: false, error: err.message };
  }
}