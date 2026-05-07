import { z } from "zod"

export default z.object({
  content: z.string().optional(),
})
