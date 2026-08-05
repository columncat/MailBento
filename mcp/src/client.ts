/**
 * MailBento HTTP 클라이언트.
 *
 * 앱에는 API 토큰이 없다. 사람이 쓰는 것과 같은 비밀번호로 세션 쿠키를 받아
 * 그걸 계속 쓴다. 세션이 만료되면 요청이 `/login` 으로 307 되므로, 그 신호를
 * 잡아 한 번 다시 로그인하고 원래 요청을 재시도한다.
 */

export interface ClientOptions {
  baseUrl: string;
  password?: string;
  timeoutMs: number;
}

export class MailBentoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailBentoError";
  }
}

export class MailBentoClient {
  /** 서버가 준 쿠키들. name=value 만 들고 있는다. */
  private cookies = new Map<string, string>();
  private loginInFlight: Promise<void> | null = null;

  constructor(private readonly opts: ClientOptions) {}

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorbCookies(res: Response): void {
    // Node 18+ 는 getSetCookie() 로 여러 장을 나눠 준다. 한 장으로 합쳐진
    // 문자열을 쉼표로 자르면 Expires 안의 쉼표에서 잘못 쪼개진다.
    const raw =
      typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
    for (const line of raw) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || /Expires=Thu, 01 Jan 1970/i.test(line)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  private async fetchOnce(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(new URL(path, this.opts.baseUrl), {
        method,
        // 307 을 그대로 보아야 "세션 만료" 를 알아챌 수 있다. 따라가 버리면
        // 로그인 페이지 HTML 이 200 으로 도착해 JSON 파싱에서 터진다.
        redirect: "manual",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.cookieHeader() ? { cookie: this.cookieHeader()! } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      this.absorbCookies(res);
      return res;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new MailBentoError(
          `${this.opts.baseUrl} 응답이 ${this.opts.timeoutMs}ms 안에 오지 않았습니다`,
        );
      }
      throw new MailBentoError(
        `${this.opts.baseUrl} 에 연결하지 못했습니다: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** 로그인 페이지로 튕겼는가. */
  private static isAuthBounce(res: Response): boolean {
    if (res.status === 401) return true;
    if (res.status < 300 || res.status >= 400) return false;
    const loc = res.headers.get("location") ?? "";
    return loc.startsWith("/login") || loc.includes("/login");
  }

  async login(): Promise<void> {
    // 여러 요청이 동시에 만료를 만나도 로그인은 한 번만 한다.
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = (async () => {
      if (!this.opts.password) {
        throw new MailBentoError(
          "인증이 켜진 서버입니다. MAILBENTO_PASSWORD 를 설정하세요.",
          401,
        );
      }
      const res = await this.fetchOnce("POST", "/api/login", {
        password: this.opts.password,
        remember: true,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new MailBentoError(
          res.status === 401
            ? "MAILBENTO_PASSWORD 가 서버 비밀번호와 다릅니다"
            : `로그인 실패 (${res.status}) ${detail.slice(0, 200)}`,
          res.status,
        );
      }
      if (res.status === 404) {
        throw new MailBentoError(
          "이 서버에는 /api/login 이 없습니다. MailBento 를 최신으로 올리세요.",
          404,
        );
      }
    })().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res = await this.fetchOnce(method, path, body);

    if (MailBentoClient.isAuthBounce(res)) {
      await this.login();
      res = await this.fetchOnce(method, path, body);
      if (MailBentoClient.isAuthBounce(res)) {
        throw new MailBentoError(
          "로그인했는데도 인증이 통과되지 않았습니다. 쿠키가 Secure 라 http 로는 실릴 수 없는 경우가 흔합니다 — https 주소를 쓰거나 서버와 같은 호스트에서 실행하세요.",
          res.status,
        );
      }
    }

    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* HTML 등 — 자른 원문을 그대로 보여 준다 */
      }
      throw new MailBentoError(`${method} ${path} → ${res.status}: ${msg}`, res.status);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MailBentoError(
        `${method} ${path} 의 응답이 JSON 이 아닙니다: ${text.slice(0, 200)}`,
      );
    }
  }
}
