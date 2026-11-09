import { useCallback, useState } from "react";

// `failed` + an <img> ref/onError pair for "logo or fallback initial" images.
// The ref callback also covers server-rendered HTML (the homepage is
// hydrated): an image that already failed before React attached onError
// never re-fires the event, so it is detected from its state at mount
// (`complete` with no pixels). A lazy image not fetched yet isn't complete.
export function useBrokenImage(): {
  failed: boolean;
  imgRef: (img: HTMLImageElement | null) => void;
  onError: () => void;
} {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0 && img.getAttribute("src")) setFailed(true);
  }, []);
  return { failed, imgRef, onError };
}
