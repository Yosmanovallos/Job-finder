import { useState } from "react";

// "Lite embed": until the visitor clicks, this is a self-hosted thumbnail
// (YouTube's own maxresdefault, so it matches what plays) inside a plain
// link to the video — no YouTube script, cookie or connection on page load.
// The click swaps in the youtube-nocookie iframe with autoplay. Without JS
// the link still opens the video on YouTube.
const YOUTUBE_ID = "R0qO40Sbtw0";
const YOUTUBE_TITLE = "Busca empleo sin abrir diez portales | buscotrabajo.co";

// `priority`: the player sits in the first screen (/como-funciona's hero),
// where a lazy thumbnail would be the late LCP element.
export function YouTubeLite({ priority = false }: { priority?: boolean }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video bg-white">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&rel=0&playsinline=1`}
          title={YOUTUBE_TITLE}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="absolute inset-0 w-full h-full border-0"
        />
      ) : (
        <a
          href={`https://www.youtube.com/watch?v=${YOUTUBE_ID}`}
          onClick={(event) => {
            event.preventDefault();
            setPlaying(true);
          }}
          aria-label="Reproducir video: cómo funciona BuscoTrabajo"
          className="group absolute inset-0 block"
        >
          <img
            src="/home/como-funciona-video.webp"
            alt=""
            width={1280}
            height={720}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            className="block w-full h-full object-cover"
          />
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 md:w-20 md:h-20 rounded-full bg-primary border-2 border-white shadow-[3px_3px_0_hsl(var(--foreground))] md:shadow-[5px_5px_0_hsl(var(--foreground))] grid place-items-center transition-transform group-hover:scale-110 group-focus-visible:scale-110"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 md:w-8 md:h-8 ml-1 fill-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </a>
      )}
    </div>
  );
}
