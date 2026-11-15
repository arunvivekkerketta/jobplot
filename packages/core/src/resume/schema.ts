import { z } from "zod";
import type { ResumeDocument } from "./document.js";

/**
 * Runtime schema for a tailored document (Phase 6). It validates shape only;
 * truth is enforced separately by `validateResumeDocument`, because a shape is
 * not evidence that a fact exists (I1).
 */
export const resumeDocumentSchema: z.ZodType<ResumeDocument> = z.object({
  contact: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    url: z.string().optional(),
    location: z.string().optional(),
    summary: z.string().optional(),
  }),
  roles: z.array(
    z.object({
      company: z.string().min(1),
      title: z.string().min(1),
      startDate: z.string().min(1),
      endDate: z.string().optional(),
      summary: z.string().optional(),
      highlights: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string().min(1),
      area: z.string().optional(),
      studyType: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      score: z.string().optional(),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string().min(1),
      level: z.string().optional(),
      keywords: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      url: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      highlights: z.array(z.string()),
      keywords: z.array(z.string()),
    }),
  ),
  certificates: z.array(
    z.object({
      name: z.string().min(1),
      issuer: z.string().optional(),
      date: z.string().optional(),
      url: z.string().optional(),
    }),
  ),
});