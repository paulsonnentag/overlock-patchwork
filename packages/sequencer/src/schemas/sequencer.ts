import { z } from "zod"

const toggleSchema = z.object({
  toggled: z.boolean(),
  contactUrl: z.string().nullable(),
  toggleOnTime: z.number(),
})

export default z.object({
  title: z.string(),
  toggleRows: z.array(z.array(toggleSchema)),
  drumToggleRows: z.array(z.array(toggleSchema)),
  stepGrid: z.array(z.unknown()),
  config: z.object({}).passthrough(),
})
