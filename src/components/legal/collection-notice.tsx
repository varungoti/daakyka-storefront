import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * F-314: the one-line "what this is used for" notice that sits under the
 * submit button of every form that collects personal data (contact, bulk
 * order, newsletter, back-in-stock; checkout has its own, longer line with the
 * Terms and Refund links). It states the purpose and links the privacy
 * policy, which opens in a new tab so a shopper reading it keeps the form
 * they were filling in.
 *
 * No hooks and no client-only imports, so it renders inside both server and
 * client forms. It is plain text, never a required checkbox — consent boxes
 * stay where they are and stay unticked by default. The wording is
 * deliberately short; counsel should confirm it before the notice duties of
 * the Digital Personal Data Protection Act, 2023 take effect.
 */
export function CollectionNotice({ purpose, className }: { purpose: string; className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted", className)}>
      {purpose} See our{" "}
      <Link
        href="/privacy-policy"
        target="_blank"
        rel="noopener"
        className="font-semibold text-brand underline underline-offset-2"
      >
        Privacy Policy
      </Link>
      .
    </p>
  );
}
