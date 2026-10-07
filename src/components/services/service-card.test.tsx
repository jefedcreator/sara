import { renderToStaticMarkup } from "react-dom/server";
import type { ServiceDto } from "types";
import { describe, expect, it, vi } from "vitest";

import { ServiceCard, ServiceCardSkeleton } from "./service-card";

const MOCK_SERVICE: ServiceDto = {
  id: "srv_1",
  slug: "knotless-braids",
  businessId: "biz_1",
  name: "Knotless Braids",
  description: "Waist length, includes hair extensions.",
  image: "https://res.cloudinary.com/demo/image/upload/v1/sample.jpg",
  price: "25000",
  duration: 240,
  availableFrom: "08:00",
  availableTo: "17:00",
  isActive: true,
  bookingMode: "SLOT",
  checkInTime: null,
  checkOutTime: null,
  minUnits: 1,
  maxUnits: 30,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
};

describe("ServiceCard component", () => {
  it("renders the service image preview banner when an image is present", () => {
    const html = renderToStaticMarkup(
      <ServiceCard
        service={MOCK_SERVICE}
        currency="NGN"
        link="https://app.sara.ng/services/knotless-braids"
        isToggling={false}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("Knotless Braids");
    expect(html).toContain("sample.jpg");
    expect(html).toContain("Live");
    expect(html).toContain("app.sara.ng/services/knotless-braids");
  });

  it("renders fallback brand mark when service has no photo", () => {
    const serviceWithoutPhoto = { ...MOCK_SERVICE, image: null };
    const html = renderToStaticMarkup(
      <ServiceCard
        service={serviceWithoutPhoto}
        currency="NGN"
        link="https://app.sara.ng/services/knotless-braids"
        isToggling={false}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("Knotless Braids");
    // LogoMark SVG is rendered in the placeholder frame
    expect(html).toContain("svg");
    expect(html).toContain('viewBox="0 0 100 100"');
  });

  it("renders paused status when service is inactive", () => {
    const inactiveService = { ...MOCK_SERVICE, isActive: false };
    const html = renderToStaticMarkup(
      <ServiceCard
        service={inactiveService}
        currency="NGN"
        link="https://app.sara.ng/services/knotless-braids"
        isToggling={false}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("Paused");
    expect(html).toContain(
      "Paused: this link shows customers that it isn&#x27;t open.",
    );
  });

  it("renders ServiceCardSkeleton with the aspect-16/10 banner", () => {
    const html = renderToStaticMarkup(<ServiceCardSkeleton />);
    expect(html).toContain("aspect-[16/10]");
    expect(html).toContain("rounded-card");
  });
});
