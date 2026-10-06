chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'download' && msg.url) {
    const options = { url: msg.url, conflictAction: 'uniquify', saveAs: false };
    if (msg.filename) options.filename = msg.filename;
    chrome.downloads.download(
      options,
      (id) => {
        const ok = !chrome.runtime.lastError;
        sendResponse({ ok, id: ok ? id : 0, error: ok ? null : String(chrome.runtime.lastError) });
      }
    );
    return true;
  }
  return false;
});