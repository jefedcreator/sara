import "swagger-ui-react/swagger-ui.css";

import { type Metadata } from "next";
import dynamic from "next/dynamic";

import { cardMetadata } from "@/utils/metadata";

export const metadata: Metadata = cardMetadata("docs", { path: "/docs" });

const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  loading: () => <p>Loading Component...</p>,
});

export default async function ApiDocsPage() {
  return (
    <section>
      <SwaggerUI url="/openapi.json" />
    </section>
  );
}
