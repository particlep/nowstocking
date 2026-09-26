// Inline stroke icons (24px grid). They take the text color.
import type { JSX } from 'preact';

type P = JSX.SVGAttributes<SVGSVGElement>;
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true } as const;

export const SearchIcon = (p: P) => <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const ScanIcon = (p: P) => <svg {...base} stroke-width={2.4} {...p}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></svg>;
export const BoxIcon = (p: P) => <svg {...base} {...p}><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></svg>;
export const ListIcon = (p: P) => <svg {...base} {...p}><path d="M10 6h10M10 12h10M10 18h10M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>;
export const MoreIcon = (p: P) => <svg {...base} stroke-width={3} {...p}><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>;
export const BackIcon = (p: P) => <svg {...base} stroke-width={2.4} {...p}><path d="m15 18-6-6 6-6" /></svg>;
export const ChevronIcon = (p: P) => <svg {...base} stroke-width={2.4} {...p}><path d="m9 18 6-6-6-6" /></svg>;
export const PlusIcon = (p: P) => <svg {...base} stroke-width={2.6} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const CheckIcon = (p: P) => <svg {...base} stroke-width={3} {...p}><path d="m5 12 5 5 9-10" /></svg>;
export const CloseIcon = (p: P) => <svg {...base} stroke-width={2.4} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const FlagIcon = (p: P) => <svg {...base} stroke-width={2.2} {...p}><path d="M5 21V4h11l-1.5 4L16 12H5" /></svg>;
export const ArrowIcon = (p: P) => <svg {...base} stroke-width={2.2} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const UndoIcon = (p: P) => <svg {...base} stroke-width={2.4} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>;
export const BagIcon = (p: P) => <svg {...base} {...p}><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
export const PhotoIcon = (p: P) => <svg {...base} stroke-width={1.8} {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="m21 16-5-5-8 8" /></svg>;
export const CameraIcon = (p: P) => <svg {...base} {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>;
export const AlertIcon = (p: P) => <svg {...base} stroke-width={2.2} {...p}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>;

/** The NowStocking mark: scan brackets around a parts box. */
export const LogoMark = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="16" fill="#1B2A41" />
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22v-8a2 2 0 0 1 2-2h8M42 12h8a2 2 0 0 1 2 2v8M52 42v8a2 2 0 0 1-2 2h-8M22 52h-8a2 2 0 0 1-2-2v-8" stroke="#C2410C" stroke-width="4.5" />
      <path d="M21 26l11-5 11 5-11 5zM21 26v12l11 5 11-5V26M32 31v12" stroke="#FFFFFF" stroke-width="3" />
    </g>
  </svg>
);
