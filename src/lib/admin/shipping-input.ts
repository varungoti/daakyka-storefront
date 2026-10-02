/**
 * F-165: the Site Controls shipping form used to coerce every keystroke with
 * `Number(v) || 0`, so clearing "Free shipping above" instantly turned into
 * ₹0 and saving it made shipping free on every order — with no warning.
 * The form now keeps what was typed as text and runs it through this check
 * on Save: a blank or invalid amount blocks the save, and a ₹0 that makes
 * shipping free storewide has to be confirmed by the admin.
 */
export interface ShippingInputFields {
  flatRate: string;
  freeAbove: string;
}

export type ShippingInputResult =
  | {
      ok: true;
      flatRate: number;
      freeAbove: number;
      /** Set when the saved values would make shipping free on every order,
       * so the form can ask "Free shipping on all orders?" first. */
      confirmMessage: string | null;
    }
  | { ok: false; error: string };

function parseAmount(raw: string, label: string): { value: number } | { error: string } {
  const text = raw.trim();
  if (text === "") return { error: `Enter an amount for ${label} (use 0 for none).` };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    return { error: `${label} must be a number, 0 or more.` };
  }
  return { value };
}

export function checkShippingInput(fields: ShippingInputFields): ShippingInputResult {
  const flat = parseAmount(fields.flatRate, "the flat rate");
  if ("error" in flat) return { ok: false, error: flat.error };
  const free = parseAmount(fields.freeAbove, "free shipping above");
  if ("error" in free) return { ok: false, error: free.error };

  let confirmMessage: string | null = null;
  if (free.value === 0) {
    confirmMessage =
      "Free shipping above ₹0 makes shipping free on every order. Save this?";
  } else if (flat.value === 0) {
    confirmMessage = "A flat rate of ₹0 makes shipping free on every order. Save this?";
  }
  return { ok: true, flatRate: flat.value, freeAbove: free.value, confirmMessage };
}
