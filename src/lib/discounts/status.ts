/**
 * F-206: the discounts list used to show only the on/off toggle, so a code
 * past its end date, not yet started, or out of redemptions still read as
 * "Active". This derives the state a shopper would actually hit, using the
 * same boundaries as isDiscountCodeActive / assertDiscountUsable in
 * src/lib/discounts/index.ts (start inclusive, end exclusive).
 */
export type DiscountListState = "ACTIVE" | "INACTIVE" | "SCHEDULED" | "EXPIRED" | "LIMIT_REACHED";

export interface DiscountStateInput {
  active: boolean;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  maxRedemptions: number | null;
  redeemedCount: number;
}

export const DISCOUNT_STATE_LABELS: Record<DiscountListState, string> = {
  ACTIVE: "Live",
  INACTIVE: "Switched off",
  SCHEDULED: "Scheduled",
  EXPIRED: "Expired",
  LIMIT_REACHED: "Limit reached",
};

export function getDiscountListState(discount: DiscountStateInput, now: Date = new Date()): DiscountListState {
  if (!discount.active) return "INACTIVE";
  if (discount.startsAt && new Date(discount.startsAt) > now) return "SCHEDULED";
  if (discount.endsAt && new Date(discount.endsAt) <= now) return "EXPIRED";
  if (discount.maxRedemptions != null && discount.redeemedCount >= discount.maxRedemptions) return "LIMIT_REACHED";
  return "ACTIVE";
}
