import { PublicError } from "@/components/public-error";

export default function ReceiptNotFound() {
  return (
    <PublicError
      title="This link is wrong or no longer works."
      body="Ask the business to send the receipt again."
    />
  );
}
