import { centeredCoverCrop } from "./imageCrop";

const ENDPAPER_WIDTH = 768;
const ENDPAPER_HEIGHT = 1034;

/**
 * BoxGeometry orders faces [+x, -x, +y, -y, +z, -z]. A front board needs the
 * printed cover on the geometry itself: a separate coplanar plane can be
 * culled or clipped while the case swings edge-on, briefly exposing the plain
 * cloth underneath even though the image loaded. Pass the body as `cover` for
 * a board with no printed face.
 */
export function coverBoardMaterials<T>(body: T, cover: T, endpaper: T): [T, T, T, T, T, T] {
  return [body, body, body, body, cover, endpaper];
}

type ImageDimensions = {
  naturalWidth?: number;
  naturalHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
  width?: number;
  height?: number;
};

function imageDimensions(image: CanvasImageSource) {
  const source = image as ImageDimensions;
  return {
    width: source.naturalWidth ?? source.videoWidth ?? source.width ?? 0,
    height: source.naturalHeight ?? source.videoHeight ?? source.height ?? 0,
  };
}

/**
 * Paints a real printed endpaper rather than exposing an empty board while the
 * first page still faces away from the camera. The resolved cover contributes
 * only blurred low-contrast colour; its title is never mirrored onto the
 * inside cover.
 */
export function paintCoverEndpaper(canvas: HTMLCanvasElement, coverImage?: CanvasImageSource | null) {
  const width = canvas.width || ENDPAPER_WIDTH;
  const height = canvas.height || ENDPAPER_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return;

  const paper = context.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, "#eadfc7");
  paper.addColorStop(0.52, "#d9c9a7");
  paper.addColorStop(1, "#efe5cf");
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);

  if (coverImage) {
    const source = imageDimensions(coverImage);
    if (source.width > 0 && source.height > 0) {
      const crop = centeredCoverCrop(source.width, source.height, width / height);
      context.save();
      context.globalAlpha = 0.24;
      context.filter = "blur(24px) saturate(.72) contrast(.82)";
      context.drawImage(
        coverImage,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        -18,
        -18,
        width + 36,
        height + 36,
      );
      context.restore();
      context.fillStyle = "rgba(232, 219, 190, .70)";
      context.fillRect(0, 0, width, height);
    }
  }

  const outerInset = Math.round(width * 0.055);
  const innerInset = Math.round(width * 0.078);
  context.strokeStyle = "rgba(20, 63, 55, .48)";
  context.lineWidth = Math.max(2, width * 0.0045);
  context.strokeRect(outerInset, outerInset, width - outerInset * 2, height - outerInset * 2);
  context.strokeStyle = "rgba(20, 63, 55, .22)";
  context.lineWidth = Math.max(1, width * 0.002);
  context.strokeRect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);

  context.save();
  context.beginPath();
  context.rect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);
  context.clip();
  context.strokeStyle = "rgba(20, 63, 55, .105)";
  context.lineWidth = Math.max(1, width * 0.0017);
  const latticeStep = Math.max(72, Math.round(width * 0.14));
  for (let offset = -height; offset < width + height; offset += latticeStep) {
    context.beginPath();
    context.moveTo(offset, innerInset);
    context.lineTo(offset + height - innerInset * 2, height - innerInset);
    context.moveTo(width - offset, innerInset);
    context.lineTo(width - offset - height + innerInset * 2, height - innerInset);
    context.stroke();
  }
  context.restore();

  const markRadius = width * 0.068;
  context.save();
  context.translate(width / 2, height / 2);
  context.strokeStyle = "rgba(20, 63, 55, .52)";
  context.lineWidth = Math.max(2, width * 0.0035);
  context.beginPath();
  context.arc(0, 0, markRadius, 0, Math.PI * 2);
  context.stroke();
  context.rotate(Math.PI / 4);
  context.beginPath();
  context.moveTo(-markRadius * 0.55, -markRadius * 0.55);
  context.lineTo(markRadius * 0.55, -markRadius * 0.55);
  context.lineTo(markRadius * 0.55, markRadius * 0.55);
  context.lineTo(-markRadius * 0.55, markRadius * 0.55);
  context.closePath();
  context.stroke();
  context.restore();
}

export function createCoverEndpaperCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = ENDPAPER_WIDTH;
  canvas.height = ENDPAPER_HEIGHT;
  paintCoverEndpaper(canvas);
  return canvas;
}
