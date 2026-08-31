/**
 * 받아 온 바이트가 **정말 그림인지** 앞머리를 보고 판정한다.
 *
 * 왜 선언한 타입을 안 믿는가 — `Content-Type` 도 MIME 파트의 헤더도 전부
 * 발신자가 적는 값이다. 그 말을 그대로 응답에 실으면, 우리 오리진에서
 * `image/svg+xml` 이나 `text/html` 을 내보내게 된다. SVG 는 그림처럼 생겼지만
 * 안에 `<script>` 를 담을 수 있는 문서라, 같은 오리진에서 열리는 순간
 * 세션 쿠키가 붙은 채로 우리 앱의 DOM 을 만질 수 있다.
 *
 * 그래서 아래 표에 있는 **래스터 그림만** 통과시키고, 응답에는 여기서 알아낸
 * 타입을 적는다. SVG 는 글자로 된 형식이라 어떤 마법 바이트와도 안 맞아
 * 자연히 걸러진다 — 목록에서 뺀 것이 아니라 통과할 수가 없다.
 */

function ascii(buf: Buffer, at: number, len: number): string {
  return buf.subarray(at, at + len).toString("latin1");
}

/** 아는 그림이면 그 MIME 타입, 아니면 null. */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  if (
    buf[0] === 0x89 &&
    ascii(buf, 1, 3) === "PNG" &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  const head6 = ascii(buf, 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";

  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
    return "image/x-icon";
  }
  const head4 = ascii(buf, 0, 4);
  if (head4 === "II\x2a\x00" || head4 === "MM\x00\x2a") return "image/tiff";

  // ISO-BMFF 계열 — 8~11 바이트의 brand 로 갈린다
  if (ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "heic" || brand === "heix" || brand === "hevc") {
      return "image/heic";
    }
    if (brand === "mif1" || brand === "msf1") return "image/heif";
  }

  return null;
}
