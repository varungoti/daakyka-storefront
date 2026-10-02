import type { ResolvedSubject } from "@/lib/privacy/subject";

/**
 * Where-clause fragments shared by export.ts and erase.ts so both match the
 * same rows in every table. Emails are compared case-insensitively (some
 * tables hold the address as typed); phones against every spelling
 * `phoneVariants` produced.
 */

type InsensitiveEquals<F extends string> = { [K in F]: { equals: string; mode: "insensitive" } };

/** `field` equals any of the subject's emails. */
export function emailMatches<F extends string>(field: F, subject: ResolvedSubject): InsensitiveEquals<F>[] {
  return subject.emails.map((email) => ({ [field]: { equals: email, mode: "insensitive" as const } }) as InsensitiveEquals<F>);
}

/** `field` is any of the subject's phone spellings. */
export function phoneMatches<F extends string>(field: F, subject: ResolvedSubject): { [K in F]: { in: string[] } }[] {
  return subject.phones.length > 0 ? [{ [field]: { in: subject.phones } } as { [K in F]: { in: string[] } }] : [];
}

/** AdminNotification rows have no structured recipient — the customer's
 * address sits inside the free-text title / body / JSON metadata, so those
 * are searched for any of the subject's emails or phones. */
export function notificationMatches(subject: ResolvedSubject) {
  const terms = [...subject.emails, ...subject.phones];
  return terms.flatMap((term) => [
    { title: { contains: term, mode: "insensitive" as const } },
    { body: { contains: term, mode: "insensitive" as const } },
    { metadata: { contains: term, mode: "insensitive" as const } },
  ]);
}
