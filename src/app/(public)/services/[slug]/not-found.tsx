import { PublicError } from "@/components/public-error";

export default function ServiceNotFound() {
  return (
    <PublicError
      title="This service isn't taking bookings."
      body="It may have been paused or renamed. Ask the business for a fresh link."
    />
  );
}
