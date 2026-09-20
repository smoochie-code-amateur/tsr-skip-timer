const SETTINGS_KEY = 'tsrSkipSettings';

function readForm() {
  return {
    enabled: document.getElementById('enabled').checked,
    guestMode: document.getElementById('guestMode').checked,
  };
}

function fillForm(settings) {
  document.getElementById('enabled').checked = !!settings.enabled;
  document.getElementById('guestMode').checked = !!settings.guestMode;
}

async function init() {
  const res = await chrome.storage.local.get([SETTINGS_KEY]);
  fillForm(res[SETTINGS_KEY] || { enabled: true, guestMode: true });

  document.getElementById('save').addEventListener('click', async () => {
    await chrome.storage.local.set({ [SETTINGS_KEY]: readForm() });
    const saved = document.getElementById('saved');
    saved.textContent = 'Saved ✓';
    setTimeout(() => (saved.textContent = ''), 2000);
  });
}

document.addEventListener('DOMContentLoaded', init);