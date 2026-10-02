// F-258: the framer-motion feature bundle LazyMotion loads on demand — see
// src/components/layout/lazy-motion-provider.tsx. `domAnimation` is the
// animate/exit/spring/gesture set; the drawers and dialogs need nothing
// beyond it (no layout animations, no drag), so those never ship.
export { domAnimation as default } from "framer-motion";
