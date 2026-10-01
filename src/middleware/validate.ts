import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../utils/ApiError';

export const validate =
    (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
        const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
        if (!result.success) {
            return next(ApiError.badRequest(result.error.errors.map((e) => e.message).join(', ')));
        }
        Object.assign(req, result.data);
        next();
    };