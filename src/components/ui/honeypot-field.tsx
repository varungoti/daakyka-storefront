import { HONEYPOT_FIELD_NAME } from "@/lib/validation/honeypot";

/**
 * Visually hidden from real visitors (off-screen, not display:none —
 * some bots skip display:none/visibility:hidden fields specifically to
 * evade this exact trick) and unreachable by keyboard/screen reader.
 * Any value here means whatever submitted the form isn't a human using
 * this UI.
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
        autoComplete="off"
      />
    </div>
  );
}
