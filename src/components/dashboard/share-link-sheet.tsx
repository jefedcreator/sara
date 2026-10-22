"use client";

import type { ProductDto, ServiceDto } from "types";

import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";
import { Modal } from "@/primitives";
import { productPath, servicePath } from "@/utils/public-links";

interface ShareLinkSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceDto[];
  products: ProductDto[];
  publicBaseUrl: string;
}

type ShareRow = { key: string; name: string; caption: string; link: string };

/**
 * Menu item 3 for a business that sells both: every live service and product
 * with its link and a Copy button, the way the chat lists them.
 */
export function ShareLinkSheet({
  open,
  onOpenChange,
  services,
  products,
  publicBaseUrl,
}: ShareLinkSheetProps) {
  const rows: ShareRow[] = [
    ...services
      .filter((s) => s.isActive)
      .map((s) => ({
        key: `service-${s.id}`,
        name: s.name,
        caption: "Booking link",
        link: `${publicBaseUrl}${servicePath(s.slug)}`,
      })),
    ...products
      .filter((p) => p.isActive)
      .map((p) => ({
        key: `product-${p.id}`,
        name: p.name,
        caption: "Product link",
        link: `${publicBaseUrl}${productPath(p.slug)}`,
      })),
  ];

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content>
          <Modal.Handle />
          <Modal.Dismiss />
          <Modal.Title>Share a link</Modal.Title>
          <Modal.Description>
            Copy a link and send it to your customer.
          </Modal.Description>

          {rows.length === 0 ? (
            <p className="text-muted mt-6 text-[15px]">
              Nothing is live yet. Add a service or a product and its link will show here.
            </p>
          ) : (
            <ul className="mt-6 grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="bg-surface rounded-card flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{row.name}</p>
                    <p className="text-muted truncate text-sm">{row.caption}</p>
                  </div>
                  <CopyLinkButton url={row.link} />
                </li>
              ))}
            </ul>
          )}
        </Modal.Content>
      </Modal.Portal>
    </Modal>
  );
}
