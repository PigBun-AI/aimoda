import { z } from 'zod'

export const uploadContextSchema = z.object({
  uploadedBy: z.number().int().positive()
})
