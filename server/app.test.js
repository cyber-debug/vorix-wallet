import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cell } from '@ton/core';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createServices } from './services/index.js';

const TEST_CONFIG = Object.freeze({
    nodeEnv: 'test',
    isProduction: false,
    port: 4174,
    host: '127.0.0.1',
    trustProxyHops: 0,
    tonNetwork: 'testnet',
    tonChainId: '-3',
    toncenterApiBaseUrl: 'https://testnet.toncenter.com/api/v2',
    toncenterApiKey: '',
    coingeckoApiBaseUrl: 'https://api.coingecko.com/api/v3',
    appPublicUrl: 'https://beta.example.com',
    corsOrigins: Object.freeze([]),
    upstreamTimeoutMs: 1_000,
    apiRateLimitMax: 1_000,
    transferRateLimitMax: 1_000,
    maxTransferTon: '100',
});

const SENDER = `0:${'1'.repeat(64)}`;
const RECIPIENT = `0:${'2'.repeat(64)}`;

function testApp() {
    return createApp({
        appConfig: TEST_CONFIG,
        services: createServices(TEST_CONFIG),
        buildPath: '/tmp/vorix-build-does-not-exist',
    });
}

describe('VORIX API', () => {
    it('reports beta health and the configured chain', async () => {
        const response = await request(testApp()).get('/api/health').expect(200);

        expect(response.body).toMatchObject({
            ok: true,
            release: 'beta',
            network: 'testnet',
            chainId: '-3',
        });
        expect(response.headers['x-request-id']).toBeTruthy();
    });

    it('prepares an exact, chain-locked transfer with an encoded memo', async () => {
        const response = await request(testApp())
            .post('/api/transfer/prepare')
            .send({
                senderAddress: SENDER,
                recipient: RECIPIENT,
                amount: '1.000000001',
                memo: 'beta transfer',
                walletChainId: '-3',
            })
            .expect(200);

        const draft = response.body.transferDraft;
        expect(draft).toMatchObject({
            network: '-3',
            senderAddress: SENDER,
            amountTon: '1.000000001',
            amountNano: '1000000001',
            memoIncluded: true,
        });

        const payload = Cell.fromBoc(Buffer.from(draft.payload, 'base64'))[0].beginParse();
        expect(payload.loadUint(32)).toBe(0);
        expect(payload.loadStringTail()).toBe('beta transfer');
    });

    it('rejects transfers from a wallet on the wrong network', async () => {
        const response = await request(testApp())
            .post('/api/transfer/prepare')
            .send({
                senderAddress: SENDER,
                recipient: RECIPIENT,
                amount: '1',
                walletChainId: '-239',
            })
            .expect(400);

        expect(response.body.code).toBe('NETWORK_MISMATCH');
    });

    it('returns useful 400 errors for unsafe amounts and invalid addresses', async () => {
        const tooLarge = await request(testApp())
            .post('/api/transfer/prepare')
            .send({
                senderAddress: SENDER,
                recipient: RECIPIENT,
                amount: '101',
                walletChainId: '-3',
            })
            .expect(400);
        expect(tooLarge.body.code).toBe('AMOUNT_LIMIT_EXCEEDED');

        const badAddress = await request(testApp()).get('/api/balance/not-an-address').expect(400);
        expect(badAddress.body.code).toBe('INVALID_ADDRESS');
    });

    it('does not expose a server-wide wallet activity log', async () => {
        const response = await request(testApp()).get('/api/activity').expect(200);

        expect(response.body).toMatchObject({
            ok: true,
            activity: [],
            scope: 'client-only',
        });
    });

    it('serves a fixed-origin manifest and structured API 404s', async () => {
        const manifest = await request(testApp()).get('/api/tonconnect-manifest').expect(200);
        expect(manifest.body.url).toBe('https://beta.example.com');
        expect(manifest.body.iconUrl).toBe('https://beta.example.com/tonconnect-icon.png');

        const missing = await request(testApp()).get('/api/nope').expect(404);
        expect(missing.body.code).toBe('NOT_FOUND');
    });

    it('serves the SPA entry point for nested client routes', async () => {
        const buildPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vorix-build-'));
        fs.writeFileSync(
            path.join(buildPath, 'index.html'),
            '<!doctype html><title>VORIX test shell</title>'
        );

        try {
            const app = createApp({
                appConfig: TEST_CONFIG,
                services: createServices(TEST_CONFIG),
                buildPath,
            });
            const response = await request(app).get('/profile').expect(200);

            expect(response.text).toContain('VORIX test shell');
            expect(response.headers['cache-control']).toBe('no-cache');
        } finally {
            fs.rmSync(buildPath, { recursive: true, force: true });
        }
    });
});
