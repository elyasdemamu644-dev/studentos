/**
 * Sentinel for the "General study" option. Radix Select needs a non-empty
 * string value, so we cannot use "" — but it must never be sent to the API as
 * a course id (that was a 404), hence the mapping in `resolveCourseId`.
 */
export const GENERAL_COURSE = "__general";

/**
 * Maps the Select's value to the API's `courseId`: the "General study"
 * sentinel (and an empty selection) become `null`; a real course id passes
 * through. Sending the sentinel as an id used to 404.
 */
export function resolveCourseId(selected: string): string | null {
  return !selected || selected === GENERAL_COURSE ? null : selected;
}
