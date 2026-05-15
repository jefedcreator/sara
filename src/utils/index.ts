import { getChildId } from "@/utils/getChildId";
import bcrypt from "bcryptjs";
import { type ClassValue, clsx } from "clsx";
import {
  createSearchParamsCache,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
} from "nuqs/server";
import { twMerge } from "tailwind-merge";
import { generateUsername } from "unique-username-generator";
import z from "zod";
import { HttpException } from "./exceptions";

const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs));
};

const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    reader.onerror = (error) => reject(error);
  });
};

const convertBase64ToFile = (base64: string, fileName: string) => {
  const arr = base64.split(",");
  const mime = arr?.[0]?.match(/:(.*?);/)?.[1];
  const bstr = atob(arr?.[1] ?? "");
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileName, { type: mime });
};

const isFile = (item: any): item is File => item instanceof File;

const hashPassword = async (payload: string) => {
  const hash = await bcrypt.hash(payload, 10);
  return hash;
};

const verifyPassword = async (payload: string, hash: string) => {
  return await bcrypt.compare(payload, hash);
};

const uniqueNumber = () => Date.now()?.toString()?.slice(-8);

/**
 *
 * @param error
 * @returns
 */
function parseHttpError(error: any) {
  console.error(error);
  if (error instanceof HttpException || error.statusCode) {
    return error.message;
  }
  return error?.response?.message ?? error?.cause ?? error?.toString();
}

const isValidObjectId = (q?: string) => {
  if (!q) {
    return false;
  }
  return /^[0-9a-fA-F]{24}$/.test(q);
};

const parseTransactionStatus = (status?: string) => {
  if (status?.toLowerCase() != "all") {
    return status?.toLowerCase();
  }
  return undefined;
};

const generateRandomString = (length = 6): string => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
};

const genUsername = () => {
  // Try up to 5 times to generate a unique username
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    // const username = generateUsername('', 0, 8);
    // const userExists = await this.prisma.user.count({
    //   where: {
    //     username,
    //   },
    // });

    // if (userExists === 0) {
    //   return username;
    // }

    attempts++;
  }

  // If we couldn't find a unique username after 5 attempts
  // Add some random characters to make it unique
  const baseUsername = generateUsername("", 0, 6);
  const randomChars = generateRandomString();
  return `${baseUsername}${randomChars}`.substring(0, 12).toLowerCase();
};

const mongoIdValidator = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid MongoDB ID format");

const baseParams = {
  query: parseAsString,
  page: parseAsInteger.withDefault(1),
};

const exploreParams = {
  ...baseParams,
  type: parseAsStringEnum(["clubs", "leaderboards"]),
};

const notificationParams = {
  ...baseParams,
  type: parseAsStringEnum(["info", "club", "leaderboard", "reward"]),
};

const clubsParams = {
  ...baseParams,
  isActive: parseAsBoolean,
  isPublic: parseAsBoolean,
};

const leaderboardsParams = {
  ...baseParams,
  isActive: parseAsBoolean,
  isPublic: parseAsBoolean,
  type: parseAsString,
};

const leaderboardParams = {
  sortBy: parseAsStringEnum([
    "effort",
    "score",
    "pace",
    "distance",
    "createdAt",
  ]),
};

const loadLeaderboardsParams = createSearchParamsCache(leaderboardsParams);
const loadExploreParams = createSearchParamsCache(exploreParams);
const loadNotificationParams = createSearchParamsCache(notificationParams);
const loadLeaderboardParams = createSearchParamsCache(leaderboardParams);
const loadBaseParams = createSearchParamsCache(baseParams);
const loadClubsParams = createSearchParamsCache(clubsParams);

const getFontSize = (text: string, baseSize: number, minSize: number) => {
  const maxContentWidth = 1000;

  const estimatedWidth = text.length * (baseSize * 0.65);
  if (estimatedWidth > maxContentWidth) {
    return Math.max(
      minSize,
      Math.floor(maxContentWidth / (text.length * 0.65)),
    );
  }
  return baseSize;
};

/** Format total minutes → "1h 23m" or "45m" */
function formatDuration(minutes: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Parse pace string "M:SS" → total minutes for sorting */
function parsePace(pace: string | null): number {
  if (!pace) return Infinity;
  const [min, sec] = pace.split(":").map(Number);
  return (min ?? 0) + (sec ?? 0) / 60;
}

/** Convert all undefined values in an object to null */
type WithNull<T> = {
  [K in keyof T]: T[K] | null;
};

function undefinedToNull<T extends object>(obj: T): WithNull<T> {
  const result: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key] === undefined ? null : obj[key];
    }
  }
  return result as WithNull<T>;
}

export {
  cn,
  convertBase64ToFile,
  convertFileToBase64,
  exploreParams,
  formatDuration,
  generateRandomString,
  genUsername,
  getChildId,
  getFontSize,
  // getDateRange,
  hashPassword,
  HttpException,
  isFile,
  isValidObjectId,
  loadExploreParams,
  loadNotificationParams,
  loadLeaderboardParams,
  loadLeaderboardsParams,
  leaderboardsParams,
  mongoIdValidator,
  notificationParams,
  parseHttpError,
  parsePace,
  parseTransactionStatus,
  twMerge,
  uniqueNumber,
  verifyPassword,
  loadBaseParams,
  baseParams,
  loadClubsParams,
  clubsParams,
  undefinedToNull,
};

export type { WithNull };
