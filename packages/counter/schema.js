import { z } from "https://esm.sh/zod@3.23.8";

const shape = z.object({ count: z.number() });

export const counterSchema = {
  init: () => ({ count: 0 }),
  parse: (value) => shape.parse(value),
};
