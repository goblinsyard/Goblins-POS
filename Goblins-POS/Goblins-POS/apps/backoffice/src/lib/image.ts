/**
 * Read a photo, center-crop it to a square, scale it to `size` px and encode it
 * as WebP (JPEG where WebP isn't supported). A phone photo of several MB comes
 * out at roughly 30–60 KB, which keeps the POS and the website fast.
 */
export async function resizeToSquareDataUrl(file: File, size = 600): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (side < 120) throw new Error('That picture is too small — use at least 300×300');
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const target = Math.min(size, side);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
  const webp = canvas.toDataURL('image/webp', 0.82);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that picture')); };
    img.src = url;
  });
}
