import sanitizeHtml from "sanitize-html";

/**
 * 메일 HTML 본문을 안전하게 정제.
 *
 * 정책:
 * - 일반적인 텍스트/문단/리스트/링크/이미지/표 허용
 * - 모든 script, on* 핸들러 제거
 * - 외부 링크는 target=_blank + rel=noopener
 * - 인라인 스타일은 일부 안전한 속성만 허용
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "blockquote", "p", "a", "ul", "ol", "nl", "li",
      "b", "i", "strong", "em", "strike", "code",
      "hr", "br", "div", "span", "table", "thead", "caption",
      "tbody", "tr", "th", "td", "pre", "img", "figure", "figcaption",
      "sub", "sup", "small", "u",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height"],
      "*": ["style", "class"],
      table: ["border", "cellpadding", "cellspacing", "width"],
      td: ["colspan", "rowspan", "align", "valign", "width"],
      th: ["colspan", "rowspan", "align", "valign", "width"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data", "cid"],
    },
    allowedStyles: {
      "*": {
        color: [/^.*$/],
        "background-color": [/^.*$/],
        "text-align": [/^left$|^right$|^center$|^justify$/],
        "font-size": [/^.*$/],
        "font-weight": [/^.*$/],
        "font-style": [/^.*$/],
        "text-decoration": [/^.*$/],
        margin: [/^.*$/],
        padding: [/^.*$/],
        border: [/^.*$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
    },
  });
}

/** plain text 를 안전한 HTML 로 (줄바꿈 보존, URL 자동링크 안 함). */
export function plainTextToSafeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<pre style="white-space: pre-wrap; word-break: break-word; font-family: inherit; margin: 0;">${escaped}</pre>`;
}
