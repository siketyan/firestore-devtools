/** Joins the truthy class names, so conditional modifiers read cleanly. */
export function classNames(
  ...names: Array<string | false | undefined>
): string {
  return names.filter(Boolean).join(" ");
}
