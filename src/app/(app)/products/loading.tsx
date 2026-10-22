import { ProductCardSkeleton } from "@/components/products/product-card";
import { Skeleton } from "@/primitives";

/** The page body only: the chrome is the layout's and stays standing. */
export default function ProductsLoading() {
  return (
    <div
      className="grid grid-cols-1 gap-6"
      aria-busy="true"
      aria-label="Loading products"
    >
      <div>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-[420px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 min-[700px]:grid-cols-2 min-[1040px]:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
