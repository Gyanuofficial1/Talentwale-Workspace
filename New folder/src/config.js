const { z } = require("zod");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 8080))
    .pipe(z.number().int().min(1).max(65535)),
  VERIFY_API_KEY: z.string().min(12).default("local-dev-only-key"),
  ALLOWED_ORIGINS: z.string().optional(),
  REQUEST_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 15000))
    .pipe(z.number().int().min(3000).max(60000)),
  MAX_SHEET_ROWS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 200))
    .pipe(z.number().int().min(1).max(1000)),
  SMTP_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 12000))
    .pipe(z.number().int().min(3000).max(30000)),
  CONCURRENCY: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 5))
    .pipe(z.number().int().min(1).max(20)),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const config = parsed.data;

config.allowedOrigins = config.ALLOWED_ORIGINS
  ? config.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];

module.exports = config;
