import { mongoIdValidator } from '@/utils';
import z from 'zod';

export const baseQueryValidatorSchema = z
    .object({
        page: z
            .string()
            .transform((val) => parseInt(val, 10))
            .pipe(
                z
                    .number({
                        invalid_type_error: 'page must be a valid number',
                    })
                    .int('page must be an integer')
                    .min(1, 'page must be at least 1')
            )
            .default('1'),

        size: z
            .string()
            .transform((val) => parseInt(val, 10))
            .pipe(
                z
                    .number({
                        invalid_type_error: 'limit must be a valid number',
                    })
                    .int('limit must be an integer')
                    .min(1, 'limit must be at least 1')
                    .max(100, 'limit cannot exceed 100')
            )
            .default('10'),

        query: z
            .string({
                invalid_type_error: 'search must be a valid string',
            })
            .max(255, 'search cannot exceed 255 characters')
            .optional(),
        sortBy: z
            .enum(['name', 'createdAt', 'updatedAt'], {
                errorMap: () => ({
                    message: 'sortBy must be one of: name, createdAt, updatedAt',
                }),
            })
            .default('createdAt')
            .optional(),
        sortOrder: z
            .enum(['asc', 'desc'], {
                errorMap: () => ({
                    message: "sortOrder must be either 'asc' or 'desc'",
                }),
            })
            .default('desc')
            .optional(),
        all: z
            .string()
            .transform((val) => val === 'true')
            .pipe(
                z.boolean({
                    invalid_type_error: 'all must be a boolean value',
                })
            )
            .optional(),
    })
    .strict();

export type BaseQueryValidatorSchema = z.infer<typeof baseQueryValidatorSchema>;

export type BaseQueryValidatorInput = z.input<typeof baseQueryValidatorSchema>;

export const paramValidator = z.object({ id: mongoIdValidator });
