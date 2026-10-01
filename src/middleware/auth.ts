import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyJwt } from '../utils/jwt';

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return next(ApiError.unauthorized('Missing token'));
    }
    try {
        const payload = verifyJwt(header.slice(7));
        req.user = { id: payload.sub, role: payload.role, email: payload.email };
        next();
    } catch {
        next(ApiError.unauthorized('Invalid token'));
    }
};

export const requireRole =
    (...roles: Array<'customer' | 'driver' | 'merchant' | 'admin'>) =>
        (req: Request, _res: Response, next: NextFunction) => {
            if (!req.user) return next(ApiError.unauthorized());
            if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
            next();
        };