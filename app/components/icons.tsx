import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function ArrowIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function BackIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function BikeIcon(props: IconProps) {
  return <svg viewBox="0 0 32 32" aria-hidden="true" {...props}><circle cx="8" cy="23" r="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="24" cy="23" r="5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m8 23 6-10 5 10H8Zm6-10h7m-9-4h5m2 4 5 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function UploadIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function SparkIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d="M12 2c.7 5.2 2.8 7.3 8 8-5.2.7-7.3 2.8-8 8-.7-5.2-2.8-7.3-8-8 5.2-.7 7.3-2.8 8-8Zm7 14c.3 2.1 1.1 2.9 3 3.2-1.9.3-2.7 1.1-3 3.2-.3-2.1-1.1-2.9-3-3.2 1.9-.3 2.7-1.1 3-3.2Z" fill="currentColor" /></svg>;
}

export function CheckIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function InfoIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 7v1.5M12 11.5V17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
