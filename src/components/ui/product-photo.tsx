"use client";

import { useRef, useState } from "react";
import NextImage, { type ImageProps } from "next/image";
import { isGeneratedProductPhoto, wasProductOptimizerRequest } from "@/lib/media/product-photo-fallback";

/**
 * The optimizer is still the first choice (responsive widths and srcsets).
 * If it fails, the same already-processed product WebP can be read exactly
 * once from the existing first-party CDN route. Leave all other URLs alone.
 */
export function ProductPhoto(props: ImageProps) {
  if (typeof props.src !== "string" || props.loader || props.unoptimized || !isGeneratedProductPhoto(props.src)) {
    return <NextImage {...props} />;
  }
  return <RetryProductPhoto key={props.src} {...props} src={props.src} />;
}

function RetryProductPhoto({ src, onError, ...props }: ImageProps & { src: string }) {
  const attempted = useRef(false);
  const [useOriginal, setUseOriginal] = useState(false);
  return (
    <NextImage
      key={useOriginal ? "original" : "optimized"}
      {...props}
      src={src}
      unoptimized={useOriginal}
      onError={(event) => {
        if (useOriginal) {
          onError?.(event);
          return;
        }
        const image = event.currentTarget;
        if (!wasProductOptimizerRequest(image.currentSrc || image.src, image.ownerDocument.location.origin, src)) {
          onError?.(event);
          return;
        }
        // A failed responsive candidate and its src can report the same
        // error in one paint. Do not restart another CDN attempt.
        if (attempted.current) return;
        attempted.current = true;
        setUseOriginal(true);
      }}
    />
  );
}
