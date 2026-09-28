import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { RouterProvider } from './lib/router';

const mocks = vi.hoisted(() => ({
    wallet: null,
    open: vi.fn(),
    disconnect: vi.fn(),
    sendTransaction: vi.fn(),
    apiRequest: vi.fn(),
    addWalletActivity: vi.fn(),
}));

vi.mock('@tonconnect/ui-react', () => ({
    useTonWallet: () => mocks.wallet,
    useTonConnectModal: () => ({ open: mocks.open }),
    useTonConnectUI: () => [{ sendTransaction: mocks.sendTransaction, disconnect: mocks.disconnect }],
}));
vi.mock('./hooks/useWalletBackend', () => ({
    useWalletBackend: () => ({
        health: { chainId: '-3' },
        market: { priceUsd: 2, change24h: 1.5 },
        history: [],
        balance: mocks.wallet ? { address: mocks.wallet.account.address, balanceNano: '5000000000' } : null,
        errors: {},
        loading: { market: false, balance: false, history: false },
        refresh: vi.fn(),
    }),
}));
vi.mock('./hooks/useWalletActivity', () => ({ useWalletActivity: () => [] }));
vi.mock('./lib/api', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('./lib/activity', () => ({ addWalletActivity: mocks.addWalletActivity }));

function showApp(path = '/') {
    window.history.replaceState(null, '', path);
    return render(<RouterProvider><App /></RouterProvider>);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.wallet = null;


});

describe('wallet miniapp', () => {
    it('shows disconnected state without invented holdings', () => {
        showApp();
        expect(screen.getByRole('heading', { name: /your wallet at a glance/i })).toBeInTheDocument();
        expect(screen.getByText('No wallet connected')).toBeInTheDocument();
        expect(screen.queryByText('$12,982.04')).not.toBeInTheDocument();
    });

    it('previews a server estimate without claiming to execute a trade', async () => {
        mocks.apiRequest.mockResolvedValue({ quote: { kind: 'estimate', executable: false, totalUsd: 19.75, feeUsd: 0.1, slippageUsd: 0.15 } });
        showApp('/trade');
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount in TON' }), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: /preview estimate/i }));
        expect(await screen.findByText('$19.75')).toBeInTheDocument();
        expect(mocks.apiRequest).toHaveBeenCalledWith('/api/quotes/preview', { params: { side: 'buy', amount: '10' } });
        expect(screen.getByText(/quotes cannot be executed here/i)).toBeInTheDocument();
    });

    it('prepares a transfer and records it only after wallet signing', async () => {
        const address = `0:${'1'.repeat(64)}`;
        mocks.wallet = { account: { address, chain: '-3' } };
        mocks.apiRequest.mockResolvedValue({ transferDraft: { network: '-3', senderAddress: address, recipient: `0:${'2'.repeat(64)}`, amountNano: '1000000000', amountTon: '1', validUntil: 9999999999 } });
        mocks.sendTransaction.mockResolvedValue({ boc: 'signed' });
        showApp();
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        const dialog = within(screen.getByRole('dialog', { name: 'Send TON' }));
        fireEvent.change(dialog.getByPlaceholderText('EQ…'), { target: { value: `0:${'2'.repeat(64)}` } });
        fireEvent.change(dialog.getByPlaceholderText('0.00'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: /review in wallet/i }));
        await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalledOnce());
        expect(mocks.apiRequest).toHaveBeenCalledWith('/api/transfer/prepare', expect.objectContaining({ method: 'POST' }));
        expect(mocks.addWalletActivity).toHaveBeenCalledOnce();
    });
    it('refuses a prepared transfer whose recipient changed', async () => {
        const address = `0:${'1'.repeat(64)}`;
        mocks.wallet = { account: { address, chain: '-3' } };
        mocks.apiRequest.mockResolvedValue({ transferDraft: {
            network: '-3', senderAddress: address, recipient: `0:${'3'.repeat(64)}`,
            amountNano: '1000000000', amountTon: '1', validUntil: 9999999999,
        } });
        showApp();
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        const dialog = within(screen.getByRole('dialog', { name: 'Send TON' }));
        fireEvent.change(dialog.getByPlaceholderText('EQ…'), { target: { value: `0:${'2'.repeat(64)}` } });
        fireEvent.change(dialog.getByPlaceholderText('0.00'), { target: { value: '1' } });
        fireEvent.click(dialog.getByRole('button', { name: /review in wallet/i }));
        expect(await dialog.findByText(/does not match the submitted details/i)).toBeInTheDocument();
        expect(mocks.sendTransaction).not.toHaveBeenCalled();
        expect(mocks.addWalletActivity).not.toHaveBeenCalled();
    });

});
