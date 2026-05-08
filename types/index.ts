import type {
    Invoice,
    InvoiceItem,
    Business,
    Payment,
} from "@prisma/client";

export interface PaginationMeta {
    total: number;
    page: number;
    size: number;
    totalPages: number;
}

export interface ApiResponse<T = unknown> {
    status: number;
    message: string;
    data: T;
}

export interface ApiError {
    message: string;
}

export interface PaginatedApiResponse<T = unknown>
    extends ApiResponse<T>,
    PaginationMeta { }

export type InvoiceListItem = Invoice & {
    items: InvoiceItem[];
    business: Business;
    booking: {
        id: string;
        slug: string;
        clientName: string;
        startTime: Date;
    } | null;
    payments: Payment[];
    _count: {
        items: number;
        payments: number;
    };
};

export type CreatedInvoice = Invoice & {
    pdf: {
        url: string,
        publicId: string,
    }
}
