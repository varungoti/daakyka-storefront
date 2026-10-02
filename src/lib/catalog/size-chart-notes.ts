/**
 * F-114: whether a size chart's free-text notes already state the unit of
 * measurement ("Measurements in inches, laid flat."). The PDP's size-guide
 * dialog adds its own "Measurements in inches." line under the table, so a
 * chart whose notes say it too used to print it twice.
 */
export function notesStateUnit(notes: string | null | undefined): boolean {
  return Boolean(notes && /measurements?\s+in\b/i.test(notes));
}
