import { z } from 'zod'

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  role: z.enum(['admin', 'editor', 'viewer'])
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72)
})

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
})
