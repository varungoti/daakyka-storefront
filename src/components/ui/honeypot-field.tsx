import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";

/**
 * Visually hidden from real visitors (off-screen, not display:none —
 * some bots skip display:none/visibility:hidden fields specifically to
 * evade this exact trick) and unreachable by keyboard/screen reader.
 * Any value here means whatever submitted the form isn't a human using
 * this UI.
 *
 * F-157: a real visitor's browser must never fill it. Chrome's address
 * autofill ignores autocomplete="off" and guesses a field's meaning from
 * its name/id/label, so the name is a meaningless token (see
 * HONEYPOT_FIELD_NAME) and autocomplete is an unrecognised value, which
 * Chrome treats as "no autofill here". The data-* attributes are the
 * opt-outs for the common password managers (LastPass, 1Password,
 * Bitwarden, generic form-type hint).
 */
export function HoneypotField() {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
    >
      <label htmlFor={HONEYPOT_FIELD_NAME}>Leave this field blank</label>
      <input
        id={HONEYPOT_FIELD_NAME}
        name={HONEYPOT_FIELD_NAME}
        type="text"
        tabIndex={-1}
        autoComplete="nope"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
      />
    </div>
  );
}
