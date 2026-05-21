import { env } from "@/env";

// --- Types ---

export type MonoExchangeResponse = {
  id: string;
};

export type MonoBankInfo = {
  name: string;
  bank_code: string;
  type: string
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
      throw new Error("MONO_SECRET_KEY is not configured");
    }
    return env.MONO_SECRET_KEY;
  }

  private getClientId(): string {
    if (!env.MONO_CLIENT_ID) {
      throw new Error("MONO_CLIENT_ID is not configured");
    }
    return env.MONO_CLIENT_ID;
  }

  // private getPublicKey(): string {
  //   if (!env.MONO_PUBLIC_KEY) {
  //     throw new Error("MONO_PUBLIC_KEY is not configured");
  //   }
  //   return env.MONO_PUBLIC_KEY;
  // }

  /**
   * Returns the Mono public key (client ID) for initialising the Connect widget
   * on the client side via @mono.co/connect.js.
   */
  getPublicKey(): string {
    return this.getClientId();
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "mono-sec-key": this.getSecretKey(),
        ...options.headers,
      },
    });

    const data = (await response.json().catch(() => null)) as
      | (T & MonoApiError)
      | null;
    // console.log('data', data);

    if (!response.ok || !data) {
      const message =
        data?.message ?? data?.error ?? `Mono API error (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  /**
   * Exchanges a Mono Connect widget code for a permanent account ID.
   * POST https://api.withmono.com/v2/accounts/auth
   */
  async exchangeToken(code: string): Promise<MonoExchangeResponse> {
    const { data } = await this.request<{ data: MonoExchangeResponse }>("/accounts/auth", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    return data
  }

  /**
   * Retrieves verified bank account details for a linked Mono account.
   */
  async getAccountDetails(accountId: string): Promise<MonoAccountDetails> {
    const { data } = await this.request<{ data: { account: MonoAccountDetails } }>(`/accounts/${accountId}`);
    return data.account
  }
}

export const monoService = new MonoService();
