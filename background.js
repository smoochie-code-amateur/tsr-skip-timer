chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'download' && msg.url) {
    chrome.downloads.download(
      { url: msg.url, conflictAction: 'uniquify', saveAs: false },
      (id) => {
        const ok = !chrome.runtime.lastError;
        sendResponse({ ok, id: ok ? id : 0, error: ok ? null : String(chrome.runtime.lastError) });
      }
    );
    return true;
  }
  return false;
});