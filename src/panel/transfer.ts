/**
 * Getting the capture out of the panel: onto the clipboard, or into a file.
 *
 * A DevTools panel is an extension page in an iframe, which is enough of an
 * odd context that both of these need a fallback.
 */

/** Puts text on the clipboard, reporting whether it got there. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // `navigator.clipboard` needs a focused document, which a panel loses the
    // moment the click that called this moves focus.
    return copyByExecCommand(text);
  }
}

function copyByExecCommand(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.append(textarea);

  try {
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** Hands the browser a file to save. */
export function downloadText(
  filename: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  // The blob has to outlive the click, but not much longer.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
