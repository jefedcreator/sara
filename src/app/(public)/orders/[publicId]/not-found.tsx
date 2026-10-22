import { PublicError } from "@/components/public-error";

export default function OrderNotFound() {
  return (
    <PublicError
      title="This order link is wrong or no longer works."
      body="Ask the business to send it again."
    />
  );
}
