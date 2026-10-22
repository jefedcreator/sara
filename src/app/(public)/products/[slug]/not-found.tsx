import { PublicError } from "@/components/public-error";

export default function ProductNotFound() {
  return (
    <PublicError
      title="This product isn't for sale."
      body="It may have been paused or renamed. Ask the business for a fresh link."
    />
  );
}
