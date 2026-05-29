import { z } from "zod";

const envSchema = z.object({
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY is required. Generate with: openssl rand -base64 32"),

  DATABASE_PATH: z.string().default("./data/mailbento.db"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/api/auth/google/callback"),

  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default("common"),
  MICROSOFT_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/api/auth/microsoft/callback"),
  MICROSOFT_IMAP_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/api/auth/microsoft-imap/callback"),

  REFRESH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(180),
  MESSAGES_PER_BOX: z.coerce.number().int().positive().max(50).default(15),

  /**
   * 인증 설정 — 둘 다 비우면 인증 비활성 (앱 그대로 공개).
   * - AUTH_PASSWORD: plaintext 또는 bcrypt 해시 ($2a$ / $2b$ 시작). 둘 다 자동 감지.
   *   bcrypt 해시 생성: `npx bcrypt-cli "내비밀번호"` 또는 온라인 도구.
   * - AUTH_SECRET: 세션 쿠키 암호화 키 (32바이트 base64).
   *   생성: `openssl rand -base64 32` 또는
   *        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   */
  AUTH_PASSWORD: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
