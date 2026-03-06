/**
 * Escape a string for safe embedding in a single-quoted bash string.
 * 'it'\''s' = 'it' + \' + 's' = it's
 */
export function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * Remove shell metacharacters for safe display in comments.
 */
export function sanitizeForComment(str: string): string {
  return str
    .replace(/\n/g, " ")
    .replace(/[$`#\\|&<>]/g, "");
}

export const GIT_REF_PATTERN = /^[a-zA-Z0-9/_.-]+$/;
export const SAFE_PATH_PATTERN = /^[a-zA-Z0-9/_. ~-]+$/;
