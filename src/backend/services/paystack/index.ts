import { env } from "@/env";
import crypto from "node:crypto";

// --- Constants ---

/**
 * The percentage of each transaction that goes to the service provider.
 * Platform keeps the remainder (1%).
 */
const DEFAULT_PROVIDER_PERCENTAGE = 99;

// --- Types ---

export type PaystackSubaccount = {
  id: number;
  subaccount_code: string;
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
  is_verified: boolean;
  active: boolean;
};

export type PaystackTransaction = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackTransactionVerification = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel: string;
  paid_at: string | null;
  metadata: Record<string, unknown>;
  customer: {
    email: string;
    first_name: string | null;
    last_name: string | null;
  };
  subaccount?: {
    subaccount_code: string;
  };
};

export type PaystackBank = {
  id: number;
  name: string;
  slug: string;
  code: string;
  country: string;
  currency: string;
  type: string;
  active: boolean;
};

export type PaystackResolvedAccount = {
  account_number: string;
  account_name: string;
  bank_id: number;
};

export type PaystackWebhookEvent = {
  event: string;
  data: {
    id: number;
    reference: string;
    amount: number;
    currency: string;
    channel: string;
    status: string;
    paid_at: string | null;
    metadata: Record<string, unknown>;
    customer: {
      email: string;
      first_name: string | null;
      last_name: string | null;
    };
    subaccount?: {
      subaccount_code: string;
    };
  };
};

type CreateSubaccountParams = {
  businessName: string;
  settlementBank: string;
  accountNumber: string;
  percentageCharge?: number;
  description?: string;
  primaryContactEmail?: string;
  primaryContactName?: string;
  primaryContactPhone?: string;
};

type InitializeTransactionParams = {
  email: string;
  /** Amount in the smallest currency unit (e.g. kobo for NGN, cents for USD) */
  amount: number;
  subaccountCode: string;
  reference?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  /** Who bears the Paystack transaction charges: 'account' (platform) or 'subaccount' (provider) */
  bearer?: "account" | "subaccount";
};

type PaystackApiResponse<T> = {
  status: boolean;
  message: string;
  data: T;
};

// --- Service ---

class PaystackService {
  private readonly baseUrl = "https://api.paystack.co";

  private getSecretKey(): string {
    if (!env.PAYSTACK_SECRET_KEY) {
      throw new Error(
        "PAYSTACK_SECRET_KEY is not configured. Set it in your environment variables.",
      );
    }
    return env.PAYSTACK_SECRET_KEY;
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
        Authorization: `Bearer ${secretKey}`,
        ...options.headers,
      },
    });

    const result = (await response.json().catch(() => null)) as
      | PaystackApiResponse<T>
      | null;

    if (!response.ok || !result || !result.status) {
      const message =
        result?.message ?? `Paystack API error (${response.status})`;
      throw new Error(message);
    }

    return result.data;
  }

  /**
   * Creates a Paystack subaccount for a service provider.
   * The provider receives (100 - platformFee)% of each transaction.
   *
   * @param params - Subaccount details including bank info.
   * @returns The created subaccount with its `subaccount_code`.
   */
  async createSubaccount(
    params: CreateSubaccountParams,
  ): Promise<PaystackSubaccount> {
    return this.request<PaystackSubaccount>("/subaccount", {
      method: "POST",
      body: JSON.stringify({
        business_name: params.businessName,
        settlement_bank: params.settlementBank,
        account_number: params.accountNumber,
        percentage_charge:
          params.percentageCharge ?? DEFAULT_PROVIDER_PERCENTAGE,
        description: params.description,
        primary_contact_email: params.primaryContactEmail,
        primary_contact_name: params.primaryContactName,
        primary_contact_phone: params.primaryContactPhone,
      }),
    });
  }

  /**
   * Initializes a Paystack transaction with split payment to a subaccount.
   *
   * @param params - Transaction details including subaccount code.
   * @returns Authorization URL (payment link) and reference.
   */
  async initializeTransaction(
    params: InitializeTransactionParams,
  ): Promise<PaystackTransaction> {
    return this.request<PaystackTransaction>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: params.email,
        amount: params.amount,
        subaccount: params.subaccountCode,
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
        bearer: params.bearer ?? "account",
      }),
    });
  }

  /**
   * Verifies the status of a transaction by its reference.
   *
   * @param reference - The transaction reference from initialization.
   * @returns Full transaction details including payment status.
   */
  async verifyTransaction(
    reference: string,
  ): Promise<PaystackTransactionVerification> {
    return this.request<PaystackTransactionVerification>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
  }

  /**
   * Lists all supported banks for a given country.
   *
   * @param country - ISO country code (default: "nigeria").
   * @returns Array of supported banks with codes.
   */
  async listBanks(country = "nigeria"): Promise<PaystackBank[]> {
    return this.request<PaystackBank[]>(
      `/bank?country=${encodeURIComponent(country)}`,
    );
  }

  /**
   * Resolves a bank account number to verify it and retrieve the account name.
   *
   * @param accountNumber - The NUBAN account number to resolve.
   * @param bankCode - The bank code (e.g. "044" for Access Bank).
   * @returns Resolved account details including the account holder name.
   */
  async resolveAccountNumber(
    accountNumber: string,
    bankCode: string,
  ): Promise<PaystackResolvedAccount> {
    return this.request<PaystackResolvedAccount>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
  }

  /**
   * Verifies a Paystack webhook signature using HMAC SHA-512.
   *
   * @param rawBody - The raw request body as a string.
   * @param signature - The `x-paystack-signature` header value.
   * @returns `true` if the signature is valid.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const webhookSecret = env.PAYSTACK_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error(
        "PAYSTACK_WEBHOOK_SECRET is not configured. Set it in your environment variables.",
      );
    }

    const hash = crypto
      .createHmac("sha512", webhookSecret)
      .update(rawBody)
      .digest("hex");

    return hash === signature;
  }
}

export const paystackService = new PaystackService();
