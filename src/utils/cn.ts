import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists; later classes win on conflicts. Safe to import from client components. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
