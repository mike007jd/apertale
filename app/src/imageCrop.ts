type CropRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Source rectangle that fills a target aspect ratio without distorting the image. */
export function centeredCoverCrop(sourceWidth: number, sourceHeight: number, targetAspect: number): CropRectangle {
  if (![sourceWidth, sourceHeight, targetAspect].every(Number.isFinite)
      || sourceWidth <= 0 || sourceHeight <= 0 || targetAspect <= 0) {
    throw new RangeError("Cover-crop dimensions must be positive");
  }

  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect > targetAspect) {
    const width = sourceHeight * targetAspect;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }

  const height = sourceWidth / targetAspect;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

/** Destination rectangle that keeps the complete source visible inside a target. */
export function centeredContainPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CropRectangle {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(Number.isFinite)
      || sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    throw new RangeError("Contain dimensions must be positive");
  }
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}
