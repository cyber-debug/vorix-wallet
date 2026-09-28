import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import config from './config.js';
import { asyncRoute, errorMiddleware, validationError } from './lib/errors.js';
import { createServices } from './services/index.js';

const API_PREFIX = '/api';
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultBuildPath = path.join(currentDirectory, '..', 'build');

function rateLimitHandler(req, res) {
    res.status(429).json({
        ok: false,
        error: 'Too many requests. Please try again later.',
        code: 'RATE_LIMITED',
        requestId: req.id,
    });
}

function parseQuoteAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
        throw validationError('Quote amount must be between 0 and 1,000,000 TON.', 'INVALID_AMOUNT');
    }
    return amount;
}

function parseQuoteSide(value) {
    const side = String(value || '').toLowerCase();
    if (side !== 'buy' && side !== 'sell') {
        throw validationError('Quote side must be buy or sell.', 'INVALID_SIDE');
    }
    return side;
}

function parseHistoryDays(value) {
    const days = Number(value ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
        throw validationError('History days must be an integer between 1 and 30.', 'INVALID_DAYS');
    }
    return days;
}

function buildQuote({ side, amountTon, market }) {
    const feeRate = side === 'buy' ? 0.0042 : 0.0032;
    const slippageRate = side === 'buy' ? 0.0085 : 0.0072;
    const grossUsd = amountTon * market.priceUsd;
    const feeUsd = grossUsd * feeRate;
    const slippageUsd = grossUsd * slippageRate;
    const totalUsd = side === 'buy'
        ? grossUsd + feeUsd + slippageUsd
        : grossUsd - feeUsd - slippageUsd;

    return {
        quoteId: crypto.randomUUID(),
        kind: 'estimate',
        executable: false,
        side,
        amountTon,
        marketPriceUsd: market.priceUsd,
        grossUsd: Number(grossUsd.toFixed(2)),
        feeUsd: Number(feeUsd.toFixed(2)),
        slippageUsd: Number(slippageUsd.toFixed(2)),
        totalUsd: Number(totalUsd.toFixed(2)),
        estimatedRate: Number((totalUsd / amountTon).toFixed(4)),
        createdAt: new Date().toISOString(),
    };
}

function requestOrigin(req, appConfig) {
    if (appConfig.appPublicUrl) {
        return appConfig.appPublicUrl;
    }

    try {
        return new URL(`${req.protocol}://${req.get('host')}`).origin;
    } catch {
        throw validationError('Request host is invalid.', 'INVALID_HOST');
    }
}

export function createApp({
    appConfig = config,
    services = createServices(appConfig),
    buildPath = defaultBuildPath,
} = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', appConfig.trustProxyHops);

    app.use((req, res, next) => {
        req.id = crypto.randomUUID();
        req.logError = (error) => {
            console.error(`[${req.id}]`, error);
        };
        res.setHeader('X-Request-Id', req.id);
        next();
    });
    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", 'https://telegram.org'],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
                    connectSrc: ["'self'", 'https:', 'wss:'],
                    fontSrc: ["'self'", 'https:', 'data:'],
                    objectSrc: ["'none'"],
                    frameSrc: ["'none'"],
                    formAction: ["'self'"],
                    baseUri: ["'self'"],
                },
            },
            crossOriginEmbedderPolicy: false,
            referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        })
    );
    app.use(compression());
    app.use(express.json({ limit: '32kb' }));
    if (appConfig.nodeEnv !== 'test') {
        app.use(morgan(appConfig.isProduction ? 'combined' : 'dev'));
    }
    app.use(
        cors({
            origin(origin, callback) {
                const allowed = !origin || appConfig.corsOrigins.includes(origin);
                callback(null, allowed);
            },
            methods: ['GET', 'POST', 'OPTIONS'],
        })
    );

    const apiLimiter = rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: appConfig.apiRateLimitMax,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: rateLimitHandler,
    });
    const transferLimiter = rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: appConfig.transferRateLimitMax,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: rateLimitHandler,
    });

    app.use(API_PREFIX, apiLimiter);

    app.get(`${API_PREFIX}/health`, (req, res) => {
        res.json({
            ok: true,
            service: 'vorix-wallet-api',
            release: 'beta',
            environment: appConfig.nodeEnv,
            network: appConfig.tonNetwork,
            chainId: appConfig.tonChainId,
            uptimeSeconds: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            requestId: req.id,
        });
    });

    app.get(`${API_PREFIX}/tonconnect-manifest`, (req, res) => {
        const origin = requestOrigin(req, appConfig);
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json({
            url: origin,
            name: 'VORIX Wallet Beta',
            iconUrl: new URL('/tonconnect-icon.png', `${origin}/`).toString(),
        });
    });

    app.get(`${API_PREFIX}/market/ton`, asyncRoute(async (req, res) => {
        const market = await services.market.getMarket();
        res.json({ ok: true, market, requestId: req.id });
    }));

    app.get(`${API_PREFIX}/market/ton/history`, asyncRoute(async (req, res) => {
        const history = await services.market.getHistory(parseHistoryDays(req.query.days));
        res.json({ ok: true, ...history, requestId: req.id });
    }));

    app.get(`${API_PREFIX}/quotes/preview`, asyncRoute(async (req, res) => {
        const side = parseQuoteSide(req.query.side);
        const amountTon = parseQuoteAmount(req.query.amount);
        const market = await services.market.getMarket();
        const quote = buildQuote({ side, amountTon, market });
        res.json({ ok: true, quote, market, requestId: req.id });
    }));

    app.post(`${API_PREFIX}/transfer/prepare`, transferLimiter, (req, res) => {
        const transferDraft = services.transfer.prepare(req.body);
        res.json({ ok: true, transferDraft, requestId: req.id });
    });

    app.get(`${API_PREFIX}/balance/:address`, asyncRoute(async (req, res) => {
        const balance = await services.balance.getBalance(req.params.address);
        res.json({ ok: true, balance, requestId: req.id });
    }));

    app.get(`${API_PREFIX}/dashboard`, asyncRoute(async (req, res) => {
        const market = await services.market.getMarket();
        res.json({
            ok: true,
            market,
            activity: [],
            activityScope: 'client-only',
            health: {
                service: 'vorix-wallet-api',
                release: 'beta',
                network: appConfig.tonNetwork,
                chainId: appConfig.tonChainId,
                uptimeSeconds: Math.round(process.uptime()),
            },
            requestId: req.id,
        });
    }));

    app.get(`${API_PREFIX}/activity`, (req, res) => {
        res.json({
            ok: true,
            activity: [],
            scope: 'client-only',
            message: 'Private wallet activity is not stored by the API.',
            requestId: req.id,
        });
    });

    app.use(API_PREFIX, (req, res) => {
        res.status(404).json({
            ok: false,
            error: 'API endpoint not found.',
            code: 'NOT_FOUND',
            requestId: req.id,
        });
    });

    if (fs.existsSync(buildPath)) {
        app.use(express.static(buildPath, {
            etag: true,
            setHeaders(res, filePath) {
                if (filePath.includes(`${path.sep}assets${path.sep}`)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                } else {
                    res.setHeader('Cache-Control', 'public, max-age=300');
                }
            },
        }));

        app.get(/.*/, (req, res) => {
            res.setHeader('Cache-Control', 'no-cache');
            res.sendFile(path.join(buildPath, 'index.html'));
        });
    }

    app.use((req, res) => {
        res.status(404).json({
            ok: false,
            error: 'Not found.',
            code: 'NOT_FOUND',
            requestId: req.id,
        });
    });
    app.use(errorMiddleware);

    return app;
}

export default createApp;
