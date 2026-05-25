// Robust clipboard helper that works inside sandboxed iframes (e.g. Emergent preview)
// where the modern Clipboard API is blocked by Permissions Policy.
// Falls back to a hidden textarea + document.execCommand('copy').

export async function copyToClipboard(text) {
  const value = String(text ?? "");
  // Try modern API only when permissions allow it.
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      window.isSecureContext &&
      // permissions API may not exist; guard it
      (!navigator.permissions || true)
    ) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
    // fall through to legacy path
  }

  // Legacy fallback — works in iframes regardless of clipboard permission policy.
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}
