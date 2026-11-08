import type { DashboardData } from "@/types";

/**
 * Compile-time proof that the server data-fetch layer and the documented API
 * DTOs still agree. Nothing here runs: each assertion fails `tsc` the moment a
 * service response type drifts from the DTO the client is written against.
 *
 * Add a line per resource when its DTO or its `src/server` wrapper changes.
 */

/** Resolves only when both types are mutually assignable. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Fails to compile unless `A` and `B` are the same type. */
type Assert<T extends true> = T;

/** The dashboard page's payload. */
export type DashboardContract = Assert<
  Equal<
    Awaited<ReturnType<typeof import("@/server").getDashboard>>,
    DashboardData
  >
>;
