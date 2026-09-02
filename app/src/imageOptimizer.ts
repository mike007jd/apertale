import { SUPPORTED_IMAGE_TYPES } from "./bookElementGrammar";
export const MAX_SOURCE_IMAGE_BYTES = 12_000_000;
const MAX_STORED_IMAGE_BYTES = 1_500_000;
const MAX_STORED_IMAGE_DIMENSION = 2048;
const ANALYSIS_MAX_DIMENSION = 512;
/** Smallest split tile: the background check wants 1024×512 and 632 keeps the 1.62:1 stage. Generators ignore pixel-size requests, so tiles are upscaled here. */
const MIN_TILE = { width: 1024, height: 632 };
/** Max channel distance from the backdrop colour: at or below KEY_CLEAR a pixel is transparent, from KEY_SOLID up it is untouched. */
const KEY_CLEAR = 16;
const KEY_SOLID = 64;
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
  /** Normalized box around the visible pixels; absent when nothing is visible. */
  visibleBounds?: { x: number; y: number; w: number; h: number };
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
  const extension = type === "image/jpeg" ? ".jpg" : type === "image/webp" ? ".webp" : ".png";
  return `${name.replace(/\.[^.]+$/, "") || "Imported image"}${extension}`;
}

const decodeImage = (blob: Blob): Promise<DecodedImage> => createImageBitmap(blob);

/** Inline tool-argument bytes become the same File the drop target would have handed the registry; the browser decodes the base64. */
export async function dataUrlToFile(name: string, dataUrl: string): Promise<File> {
  if (!dataUrl.startsWith("data:image/")) throw new TypeError("Expected an image data URL.");
  const blob = await (await fetch(dataUrl)).blob();
  if (!SUPPORTED_IMAGE_TYPES.has(blob.type)) throw new TypeError("Expected a PNG, JPEG, or WebP data URL.");
  return new File([blob], name, { type: blob.type });
}

/**
 * Cuts one generated sheet into equal tiles in reading order. A 2×2 sheet is
 * one ImageGen request for four spreads or four cutouts; PNG sheets keep alpha.
 */
export async function splitImageGrid(file: File, columns: number, rows: number, key = false): Promise<File[]> {
  const decoded = await decodeImage(file);
  try {
    const width = Math.floor(decoded.width / columns);
    const height = Math.floor(decoded.height / rows);
    if (width < 1 || height < 1) throw new RangeError("The sheet is too small to split.");
    const scale = Math.max(1, MIN_TILE.width / width, MIN_TILE.height / height);
    const tileWidth = Math.round(width * scale);
    const tileHeight = Math.round(height * scale);
    const stem = file.name.replace(/\.[^.]+$/, "");
    // WebP keeps alpha at a fraction of PNG's size; a browser without a WebP encoder answers with PNG, and the blob says so.
    return await Promise.all(Array.from({ length: columns * rows }, (_, tile) => {
      const { canvas, context } = draw(decoded, tileWidth, tileHeight, { x: (tile % columns) * width, y: Math.floor(tile / columns) * height, width, height });
      if (key) {
        const image = context.getImageData(0, 0, tileWidth, tileHeight);
        keyOutBackdrop(image.data, tileWidth, tileHeight);
        context.putImageData(image, 0, 0);
      }
      return encode(canvas, "image/webp", 0.92).then((blob) => new File([blob], replaceExtension(`${stem}-${tile + 1}`, blob.type), { type: blob.type }));
    }));
  } finally {
    decoded.close?.();
  }
}

/**
 * Turns a flat backdrop into alpha in place. The backdrop colour is the mean
 * of the four corner pixels, so any solid colour the generator honoured works;
 * a baked checkerboard is two colours and needs a regenerate instead.
 */
export function keyOutBackdrop(pixels: Uint8ClampedArray, width: number, height: number) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((pixel) => pixel * 4);
  const [red, green, blue] = [0, 1, 2].map((channel) => corners.reduce((sum, offset) => sum + pixels[offset + channel], 0) / corners.length);
  // Magenta spill (red and blue both above green) measures how much backdrop bled into a visible pixel;
  // that share becomes transparency and is unmixed out of the colour so fur edges keep their own tint.
  // ponytail: assumes a magenta backdrop; a violet subject reads as spill and fades at its edges.
  const backdropSpill = Math.max(1, Math.min(red, blue) - green);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const distance = Math.max(Math.abs(pixels[offset] - red), Math.abs(pixels[offset + 1] - green), Math.abs(pixels[offset + 2] - blue));
    const alpha = Math.round(pixels[offset + 3] * Math.min(1, Math.max(0, (distance - KEY_CLEAR) / (KEY_SOLID - KEY_CLEAR))));
    const share = alpha === 0 ? 1 : Math.min(1, Math.max(0, (Math.min(pixels[offset], pixels[offset + 2]) - pixels[offset + 1]) / backdropSpill));
    pixels[offset + 3] = Math.round(alpha * (1 - share));
    if (share > 0 && share < 1) {
      pixels[offset] = (pixels[offset] - share * red) / (1 - share);
      pixels[offset + 1] = (pixels[offset + 1] - share * green) / (1 - share);
      pixels[offset + 2] = (pixels[offset + 2] - share * blue) / (1 - share);
    }
  }
}

function encode(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg" | "image/webp", quality?: number) {
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
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  const borderBand = Math.max(1, Math.floor(Math.min(width, height) * 0.02));
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const alpha = pixels[pixel * 4 + 3];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const border = x < borderBand || y < borderBand || x >= width - borderBand || y >= height - borderBand;
    if (alpha < 255) hasTransparency = true;
    if (alpha <= TRANSPARENT_ALPHA_MAX) transparentPixels += 1;
    if (alpha >= VISIBLE_ALPHA_MIN) {
      visiblePixels += 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
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
    ...(visiblePixels > 0 ? { visibleBounds: { x: minX / width, y: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height } } : {}),
  };
}

/**
 * The crop that drops a cutout's transparent margins, padded so the alpha
 * check still sees a clear border. A sheet quadrant leaves a subject floating
 * in empty space; trimmed, its box is the subject, so a layer scale means the
 * subject's size and the Agent can place it from the storyboard alone.
 */
function cutoutTrim(analysis: ImageContentAnalysis, width: number, height: number) {
  const bounds = analysis.visibleBounds;
  if (!analysis.hasMeaningfulAlpha || !bounds || (bounds.w >= 0.92 && bounds.h >= 0.92)) return null;
  const pad = 0.04;
  const x = Math.max(0, Math.floor((bounds.x - bounds.w * pad) * width));
  const y = Math.max(0, Math.floor((bounds.y - bounds.h * pad) * height));
  const right = Math.min(width, Math.ceil((bounds.x + bounds.w * (1 + pad)) * width));
  const bottom = Math.min(height, Math.ceil((bounds.y + bounds.h * (1 + pad)) * height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** Paints `source` (or just `crop` of it) scaled onto a fresh width × height canvas. */
function draw(source: CanvasImageSource, width: number, height: number, crop?: { x: number; y: number; width: number; height: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw new Error("Canvas image optimization is unavailable in this browser.");
  if (crop) context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  else context.drawImage(source, 0, 0, width, height);
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
    let analysis = analyzeDecodedImage(decoded);
    const trim = cutoutTrim(analysis, decoded.width, decoded.height);
    let source: DecodedImage = decoded;
    if (trim) {
      source = draw(decoded, trim.width, trim.height, trim).canvas;
      analysis = analyzeDecodedImage(source);
    }
    let dimensions = fitImageDimensions(source.width, source.height);
    if (!trim && dimensions.width === decoded.width && dimensions.height === decoded.height && file.size <= MAX_STORED_IMAGE_BYTES) {
      return { blob: file, name: file.name, ...dimensions, ...sourceDimensions, analysis, originalSize: file.size, optimized: false };
    }

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const { canvas } = draw(source, dimensions.width, dimensions.height);
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
            optimized: Boolean(trim) || candidate.size < file.size || candidate.type !== file.type || dimensions.width !== decoded.width || dimensions.height !== decoded.height,
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
