import { PublicError } from "@/components/public-error";

export default function BookingPublicNotFound() {
  return (
    <PublicError
      title="We couldn't find that booking."
      body="Check the link in your confirmation email, or ask the business to send it again."
    />
  );
}
