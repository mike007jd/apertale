export const MAX_SOURCE_IMAGE_BYTES = 12_000_000;
const MAX_STORED_IMAGE_BYTES = 1_500_000;
const MAX_STORED_IMAGE_DIMENSION = 2048;
const ANALYSIS_MAX_DIMENSION = 512;
const TRANSPARENT_ALPHA_MAX = 8;
const VISIBLE_ALPHA_MIN = 32;

export const IMAGE_ANALYSIS_VERSION = 1 as const;

export type ImageContentAnalysis = {
  version: typeof IMAGE_ANALYSIS_VERSION;
  hasTransparency: boolean;
  hasMeaningfulAlpha: boolean;
  transparentPixelRatio: number;
  transparentBorderRatio: number;
  visiblePixelRatio: number;
};

type DecodedImage = CanvasImageSource & { width: number; height: number; close?: () => void };

type OptimizedImage = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  analysis: ImageContentAnalysis;
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

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if ("createImageBitmap" in globalThis) return await createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
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

const boundedRatio = (count: number, total: number) => Number((count / Math.max(1, total)).toFixed(6));

/**
 * Summarizes real alpha content instead of trusting a PNG/WebP extension.
 * Meaningful cutouts need transparent area, a mostly transparent outer edge,
 * and enough visible subject pixels to rule out empty canvases.
 */
export function summarizeAlphaPixels(pixels: Uint8ClampedArray, width: number, height: number): ImageContentAnalysis {
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length < pixelCount * 4) {
    throw new TypeError("Image alpha analysis requires complete RGBA pixels.");
  }
  let transparentPixels = 0;
  let visiblePixels = 0;
  let transparentBorderPixels = 0;
  let borderPixels = 0;
  let hasTransparency = false;
  const borderBand = Math.max(1, Math.floor(Math.min(width, height) * 0.02));
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const alpha = pixels[pixel * 4 + 3];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const border = x < borderBand || y < borderBand || x >= width - borderBand || y >= height - borderBand;
    if (alpha < 255) hasTransparency = true;
    if (alpha <= TRANSPARENT_ALPHA_MAX) transparentPixels += 1;
    if (alpha >= VISIBLE_ALPHA_MIN) visiblePixels += 1;
    if (border) {
      borderPixels += 1;
      if (alpha <= TRANSPARENT_ALPHA_MAX) transparentBorderPixels += 1;
    }
  }
  const transparentPixelRatio = boundedRatio(transparentPixels, pixelCount);
  const transparentBorderRatio = boundedRatio(transparentBorderPixels, borderPixels);
  const visiblePixelRatio = boundedRatio(visiblePixels, pixelCount);
  return {
    version: IMAGE_ANALYSIS_VERSION,
    hasTransparency,
    hasMeaningfulAlpha: transparentPixelRatio >= 0.05 && transparentBorderRatio >= 0.8 && visiblePixelRatio >= 0.01,
    transparentPixelRatio,
    transparentBorderRatio,
    visiblePixelRatio,
  };
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

function analyzeDecodedImage(source: DecodedImage) {
  const dimensions = fitImageDimensions(source.width, source.height, ANALYSIS_MAX_DIMENSION);
  const { context } = draw(source, dimensions.width, dimensions.height);
  return summarizeAlphaPixels(
    context.getImageData(0, 0, dimensions.width, dimensions.height).data,
    dimensions.width,
    dimensions.height,
  );
}

/** Lazily upgrades metadata for assets imported before pixel analysis existed. */
export async function analyzeStoredImage(blob: Blob) {
  const decoded = await decodeImage(blob);
  try {
    return {
      width: decoded.width,
      height: decoded.height,
      analysis: analyzeDecodedImage(decoded),
    };
  } finally {
    decoded.close?.();
  }
}

export async function optimizeImportedImage(file: File): Promise<OptimizedImage> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new TypeError("Only PNG, JPEG, and WebP images are supported.");
  if (file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) throw new RangeError("Images must be between 1 byte and 12 MB.");

  const decoded = await decodeImage(file);
  try {
    const sourceDimensions = { sourceWidth: decoded.width, sourceHeight: decoded.height };
    let dimensions = fitImageDimensions(decoded.width, decoded.height);
    const analysis = analyzeDecodedImage(decoded);
    if (dimensions.width === decoded.width && dimensions.height === decoded.height && file.size <= MAX_STORED_IMAGE_BYTES) {
      return { blob: file, name: file.name, ...dimensions, ...sourceDimensions, analysis, originalSize: file.size, optimized: false };
    }

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const { canvas } = draw(decoded, dimensions.width, dimensions.height);
      const sourceMayHaveAlpha = file.type !== "image/jpeg";
      const outputType = sourceMayHaveAlpha && analysis.hasTransparency ? "image/png" : "image/jpeg";
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
            ...sourceDimensions,
            analysis,
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
