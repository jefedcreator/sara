import type { AuthRequest } from "@/backend/middleware/types";
import { NotFoundException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse, PaginatedApiResponse } from "types";
import {
  createRecord,
  deleteRecord,
  listRecords,
  readManifest,
  readRecord,
  updateRecord,
} from "./kit/service";
import type {
  AdminListQuery,
  AdminManifest,
  AdminRecord,
  AdminResource,
  AdminWriteBody,
} from "./kit/types";
import { resolvedAdmin } from "./registry";

// The routes' handlers. They only build Sara's envelopes: the kit's service
// does the work, and anything it throws is turned into a response by
// `withMiddleware`.

type AdminContext = { params: Record<string, string> };

/** The resource in the path. The middleware has already 404'd an unknown one. */
function resourceIn(params: Record<string, string>): AdminResource {
  const resource = resolvedAdmin.byKey.get(params.resource ?? "");
  if (!resource) throw new NotFoundException("Not Found");
  return resource;
}

/** The resource and the record key in the path. */
function recordIn(params: Record<string, string>): {
  resource: AdminResource;
  key: string;
} {
  const resource = resourceIn(params);
  const key = params.key;
  if (key === undefined) throw new NotFoundException("Not Found");
  return { resource, key };
}

export const manifestHandler = async (): Promise<Response> => {
  const response: ApiResponse<AdminManifest> = {
    status: 200,
    message: "Manifest retrieved",
    data: await readManifest(resolvedAdmin),
  };
  return NextResponse.json(response);
};

export const listHandler = async (
  request: AuthRequest<unknown, AdminListQuery>,
  { params }: AdminContext,
): Promise<Response> => {
  const resource = resourceIn(params);
  const query = request.query!;
  const { data, total } = await listRecords(resolvedAdmin, resource, query);
  const response: PaginatedApiResponse<AdminRecord[]> = {
    status: 200,
    message: `${resource.label} retrieved`,
    data,
    total,
    page: query.page,
    size: query.size,
    totalPages: Math.ceil(total / query.size),
  };
  return NextResponse.json(response);
};

export const createHandler = async (
  request: AuthRequest<AdminWriteBody>,
  { params }: AdminContext,
): Promise<Response> => {
  const resource = resourceIn(params);
  const data = await createRecord(
    resolvedAdmin,
    resource,
    request.validatedData!,
  );
  const response: ApiResponse<AdminRecord> = {
    status: 201,
    message: `${resource.singular} created`,
    data,
  };
  return NextResponse.json(response, { status: 201 });
};

export const readHandler = async (
  _request: AuthRequest,
  { params }: AdminContext,
): Promise<Response> => {
  const { resource, key } = recordIn(params);
  const response: ApiResponse<AdminRecord> = {
    status: 200,
    message: `${resource.singular} retrieved`,
    data: await readRecord(resolvedAdmin, resource, key),
  };
  return NextResponse.json(response);
};

export const updateHandler = async (
  request: AuthRequest<AdminWriteBody>,
  { params }: AdminContext,
): Promise<Response> => {
  const { resource, key } = recordIn(params);
  const data = await updateRecord(
    resolvedAdmin,
    resource,
    key,
    request.validatedData!,
  );
  const response: ApiResponse<AdminRecord> = {
    status: 200,
    message: `${resource.singular} updated`,
    data,
  };
  return NextResponse.json(response);
};

export const removeHandler = async (
  _request: AuthRequest,
  { params }: AdminContext,
): Promise<Response> => {
  const { resource, key } = recordIn(params);
  await deleteRecord(resolvedAdmin, resource, key);
  const response: ApiResponse<null> = {
    status: 200,
    message: `${resource.singular} deleted`,
    data: null,
  };
  return NextResponse.json(response);
};
