import { PublicError } from "@/components/public-error";

export default function InvoiceNotFound() {
  return (
    <PublicError
      title="This link is wrong or no longer works."
      body="Ask the business to send the invoice again."
    />
  );
}
