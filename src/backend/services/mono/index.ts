import { env } from "@/env";

// --- Types ---

export type MonoExchangeResponse = {
  id: string;
};

export type MonoBankInfo = {
  name: string;
  code: string;
};

export type MonoAccountDetails = {
  id: string;
  name: string;
  account_number: string;
  currency: string;
  type: string;
  balance: number;
  bvn: string;
  institution: MonoBankInfo;
};

type MonoApiError = {
  message?: string;
  error?: string;
};

// --- Service ---

class MonoService {
  private readonly baseUrl = "https://api.withmono.com/v2";

  private getSecretKey(): string {
    if (!env.MONO_SECRET_KEY) {
      throw new Error(
        "MONO_SECRET_KEY is not configured. Set it in your environment variables.",
      );
    }
    return env.MONO_SECRET_KEY;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const secretKey = this.getSecretKey();

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "mono-sec-key": secretKey,
        ...options.headers,
      },
    });

    const data = (await response.json().catch(() => null)) as
      | (T & MonoApiError)
      | null;

    if (!response.ok || !data) {
      const message =
        data?.message ?? data?.error ?? `Mono API error (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  /**
   * Exchanges a Mono Connect widget authorization code for an account ID.
   * @param code - The authorization code returned by the Mono Connect widget.
   * @returns The account ID used for subsequent API calls.
   */
  async exchangeToken(code: string): Promise<MonoExchangeResponse> {
    return this.request<MonoExchangeResponse>("/accounts/auth", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  /**
   * Retrieves verified bank account details for a linked account.
   * @param accountId - The Mono account ID from exchangeToken().
   * @returns Bank details including account number, bank code, and account name.
   */
  async getAccountDetails(accountId: string): Promise<MonoAccountDetails> {
    return this.request<MonoAccountDetails>(`/accounts/${accountId}`);
  }
}

export const monoService = new MonoService();
