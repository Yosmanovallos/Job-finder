// Per-icon lucide modules (see Header.tsx): the package ships no typings for
// these paths, but each default-exports the same LucideIcon component.
declare module "lucide-react/dist/esm/icons/*.mjs" {
  import type { LucideIcon } from "lucide-react";
  const Icon: LucideIcon;
  export default Icon;
}
