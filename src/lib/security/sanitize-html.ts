import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize rich-text HTML before it is rendered with `dangerouslySetInnerHTML`.
 *
 * Announcement content and quotation terms are authored in a rich-text editor
 * and stored as raw HTML, then rendered verbatim. Without sanitization a user
 * who can create those records can plant markup (`<script>`, `onerror=`,
 * `javascript:` URLs) that executes in another user's browser — an
 * authenticated, intra-tenant stored-XSS / session-theft vector.
 *
 * We allow the formatting the editor actually emits (headings, emphasis,
 * lists, links, tables) and drop everything else. DOMPurify — not a hand-rolled
 * regex — does the work, because HTML sanitization by regex is reliably
 * bypassable.
 */
const ALLOWED_TAGS = [
  "p", "br", "span", "div",
  "strong", "b", "em", "i", "u", "s", "strike",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre", "code",
  "a",
  "table", "thead", "tbody", "tr", "th", "td",
  "hr",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel", "colspan", "rowspan", "style"];

export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Only http(s)/mailto/tel links survive; javascript: and data: are dropped.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  });
}
