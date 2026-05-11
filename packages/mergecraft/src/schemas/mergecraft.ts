import { z } from "zod";

export default z.object({
  title: z.string(),
  cubes: z.array(z.tuple([z.number(), z.number(), z.number()])),
});
