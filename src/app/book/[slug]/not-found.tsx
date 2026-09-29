import { PublicError } from "@/components/public-error";

export default function BookingNotFound() {
  return (
    <PublicError
      title="This booking link isn't open."
      body="The service may have been paused or renamed. Ask the business for a fresh link."
    />
  );
}
