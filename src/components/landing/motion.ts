/*
 * Scroll motion. LandingMotion puts [data-motion] on the page root and
 * [data-in] on each [data-arrive] group as it enters the viewport.
 * ARRIVE_ITEM: a child that waits (hidden) until its group is in, staggered by --i.
 * ARRIVE_SELF: a group that fades in as a whole.
 * Without JS or with reduced motion, [data-motion] is never set and nothing hides.
 */
export const ARRIVE_ITEM =
  "transition-[opacity,translate,scale] duration-600 ease-out-expo delay-[calc(var(--i,0)*120ms)] [[data-motion]_[data-arrive]:not([data-in])_&]:translate-y-2.5 [[data-motion]_[data-arrive]:not([data-in])_&]:scale-98 [[data-motion]_[data-arrive]:not([data-in])_&]:opacity-0";
export const ARRIVE_SELF =
  "transition-[opacity,translate] duration-700 ease-out-expo [[data-motion]_&:not([data-in])]:translate-y-4 [[data-motion]_&:not([data-in])]:opacity-0";
