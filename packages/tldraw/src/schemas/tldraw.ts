import { z } from "zod";

export default z.object({
  store: z.record(z.any()),
  schema: z.object({
    schemaVersion: z.number(),
  }).passthrough(),
});
