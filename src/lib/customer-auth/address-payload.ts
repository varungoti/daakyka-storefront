/**
 * F-130: the JSON body the account address form sends for create (POST) and
 * edit (PATCH). Pure and client-safe (no server imports) so a test can run the
 * real form-to-wire step.
 *
 * An optional field the shopper left blank is sent as an explicit `null`, not
 * `undefined`: JSON.stringify drops `undefined` keys, so the PATCH never
 * reached the column and "Flat 4B" or a phone number could not be removed
 * while the page said it had saved. On PATCH an omitted key means "unchanged"
 * and `null` means "clear" (customerAddressUpdateSchema); on POST `null` just
 * stores no value.
 */
export interface AddressFormFields {
  label: string;
  recipientName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  /** Already normalised and validated by the caller. */
  postalCode: string;
  country: string;
  /** Already normalised by the caller; `null` when the field was blank. */
  phone: string | null;
  isDefault: boolean;
}

export function buildAddressPayload(fields: AddressFormFields) {
  return {
    label: fields.label.trim() || null,
    recipientName: fields.recipientName,
    line1: fields.line1,
    line2: fields.line2.trim() || null,
    city: fields.city,
    state: fields.state,
    postalCode: fields.postalCode,
    country: fields.country || "IN",
    phone: fields.phone,
    isDefault: fields.isDefault,
  };
}
