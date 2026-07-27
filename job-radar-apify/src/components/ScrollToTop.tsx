import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// BrowserRouter doesn't reset scroll position on client-side navigation the
// way a full page load does — without this, clicking a link while scrolled
// down (e.g. a footer link) swaps the page underneath but leaves the
// viewport at the same offset, which reads as "the link did nothing".
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
