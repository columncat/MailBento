/**
 * 업로드한 이미지 파일을 아이콘용 data URL 로 변환.
 * - SVG: 벡터 유지를 위해 그대로 data URL 반환
 * - 그 외: canvas 로 max 픽셀까지 축소 후 PNG data URL (용량 절약)
 * 결과 문자열은 iconUrl 자리에 그대로 들어가며 백업(내보내기)에도 함께 포함된다.
 */
export async function fileToIconDataUrl(
  file: File,
  max = 128,
): Promise<string> {
  const dataUrl = await readAsDataUrl(file);

  // SVG 는 래스터화하지 않고 그대로 사용
  if (file.type === "image/svg+xml") return dataUrl;

  const img = await loadImage(dataUrl);
  const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
  const w = Math.max(1, Math.round((img.width || max) * scale));
  const h = Math.max(1, Math.round((img.height || max) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("파일을 읽을 수 없습니다"));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다"));
    img.src = src;
  });
}
