"use client";
import { useMonoConnect } from "@/utils/hooks/useMonoConnect";
import { env } from "@/env";
import { useState } from "react";

export default function BusinessForm() {
  const [monoCode, setMonoCode] = useState<string | null>(null);

  const { open, isLoading } = useMonoConnect({
    publicKey: env.NEXT_PUBLIC_MONO_PUBLIC_KEY ?? "",
    onSuccess: ({ code }) => {
        console.log('code',code);
        
      setMonoCode(code); // store it, then include in POST /api/business
    },
    onClose: () => console.log("Widget closed"),
  });

  const handleSubmit = async (formData: FormData) => {
    await fetch("/api/business", {
      method: "POST",
      body: JSON.stringify({ ...formData, monoCode }), // monoCode is optional
    });
  };

  return (
    <>
      {!monoCode ? (
        <>
          <button onClick={open} disabled={isLoading}>
            Link Bank Account via Mono
          </button>
          {monoCode && <p>✓ Bank linked — ready to submit</p>}
        </>
      ) : (
        <form action={handleSubmit}>
          <input type="text" name="name" />
          <button type="submit">Submit</button>
        </form>
      )}
    </>
  );
}
