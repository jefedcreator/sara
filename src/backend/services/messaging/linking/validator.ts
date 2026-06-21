import { z } from "zod";

export const linkValidatorSchema = z
  .object({ token: z.string().min(1, "token is required") })
  .strict();

export type LinkValidatorSchema = z.infer<typeof linkValidatorSchema>;
