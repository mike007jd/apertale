export const MAX_SOURCE_IMAGE_BYTES = 12_000_000;
export const MAX_STORED_IMAGE_BYTES = 1_500_000;
export const MAX_STORED_IMAGE_DIMENSION = 2048;

type DecodedImage = CanvasImageSource & { width: number; height: number; close?: () => void };

export type OptimizedImage = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  originalSize: number;
  optimized: boolean;
};

export function fitImageDimensions(width: number, height: number, maximum = MAX_STORED_IMAGE_DIMENSION) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function replaceExtension(name: string, type: string) {
  const extension = type === "image/jpeg" ? ".jpg" : ".png";
  return `${name.replace(/\.[^.]+$/, "") || "Imported image"}${extension}`;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if ("createImageBitmap" in globalThis) return await createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new TypeError("The selected image could not be decoded."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the optimized image.")), type, quality);
  });
}

function containsTransparency(context: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

function draw(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw new Error("Canvas image optimization is unavailable in this browser.");
  context.drawImage(source, 0, 0, width, height);
  return { canvas, context };
}

export async function optimizeImportedImage(file: File): Promise<OptimizedImage> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new TypeError("Only PNG, JPEG, and WebP images are supported.");
  if (file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) throw new RangeError("Images must be between 1 byte and 12 MB.");

  const decoded = await decodeImage(file);
  try {
    let dimensions = fitImageDimensions(decoded.width, decoded.height);
    if (dimensions.width === decoded.width && dimensions.height === decoded.height && file.size <= MAX_STORED_IMAGE_BYTES) {
      return { blob: file, name: file.name, ...dimensions, originalSize: file.size, optimized: false };
    }

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const { canvas, context } = draw(decoded, dimensions.width, dimensions.height);
      const sourceMayHaveAlpha = file.type !== "image/jpeg";
      const outputType = sourceMayHaveAlpha && containsTransparency(context, dimensions.width, dimensions.height) ? "image/png" : "image/jpeg";
      const qualities = outputType === "image/jpeg" ? [0.88, 0.8, 0.72] : [undefined];

      let smallest: Blob | null = null;
      for (const quality of qualities) {
        const candidate = await encode(canvas, outputType, quality);
        if (!smallest || candidate.size < smallest.size) smallest = candidate;
        if (candidate.size <= MAX_STORED_IMAGE_BYTES) {
          return {
            blob: candidate,
            name: replaceExtension(file.name, outputType),
            ...dimensions,
            originalSize: file.size,
            optimized: candidate.size < file.size || candidate.type !== file.type || dimensions.width !== decoded.width || dimensions.height !== decoded.height,
          };
        }
      }

      if (!smallest) throw new Error("The browser could not encode the optimized image.");
      const shrink = Math.max(0.62, Math.min(0.88, Math.sqrt(MAX_STORED_IMAGE_BYTES / smallest.size) * 0.92));
      const nextDimensions = {
        width: Math.max(1, Math.round(dimensions.width * shrink)),
        height: Math.max(1, Math.round(dimensions.height * shrink)),
      };
      if (Math.min(nextDimensions.width, nextDimensions.height) < 240) break;
      dimensions = nextDimensions;
    }
  } finally {
    decoded.close?.();
  }

  throw new RangeError("This image could not be reduced below 1.5 MB without becoming too small.");
}
