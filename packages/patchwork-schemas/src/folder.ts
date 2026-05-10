import { z } from "zod";

export const folderSchema = z.object({
  title: z.string(),
  docs: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      url: z.string(),
      icon: z.string().optional(),
    })
  ),
});

export type FolderDoc = z.infer<typeof folderSchema>;
export type FolderDocLink = FolderDoc["docs"][number];
