import { useCallback, useEffect, useState } from 'react';
import { APP_CONFIG } from '../config';
import { apiRequest } from '../lib/api';

const HISTORY_DAYS = { '1D': 1, '1W': 7, '1M': 30 };

export function useWalletBackend(address, range) {
    const [health, setHealth] = useState(null);
    const [market, setMarket] = useState(null);
    const [historyState, setHistoryState] = useState({ range: '', series: [] });
    const [balance, setBalance] = useState(null);
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState({ market: true, balance: false, history: true });
    const [revision, setRevision] = useState(0);
    const refresh = useCallback(() => setRevision(value => value + 1), []);

    useEffect(() => {
        const controller = new AbortController();
        apiRequest('/api/health', { signal: controller.signal })
            .then(data => {
                if (data.chainId !== APP_CONFIG.tonChainId) throw new Error('API and wallet app are configured for different TON networks.');
                setHealth(data);
                setErrors(previous => ({ ...previous, health: '' }));
            })
            .catch(error => { if (!controller.signal.aborted) { setHealth(null); setErrors(previous => ({ ...previous, health: error.message || 'API unavailable.' })); } });
        return () => controller.abort();
    }, [revision]);

    useEffect(() => {
        const controller = new AbortController();
        apiRequest('/api/market/ton', { signal: controller.signal })
            .then(data => {
                if (!Number.isFinite(data.market?.priceUsd)) throw new Error('Market response was invalid.');
                setMarket(data.market);
                setErrors(previous => ({ ...previous, market: '' }));
            })
            .catch(error => { if (!controller.signal.aborted) { setMarket(null); setErrors(previous => ({ ...previous, market: error.message || 'Market unavailable.' })); } })
            .finally(() => { if (!controller.signal.aborted) setLoading(previous => ({ ...previous, market: false })); });
        return () => controller.abort();
    }, [revision]);

    useEffect(() => {
        const controller = new AbortController();
        apiRequest('/api/market/ton/history', { params: { days: HISTORY_DAYS[range] || 1 }, signal: controller.signal })
            .then(data => {
                setHistoryState({ range, series: Array.isArray(data.series) ? data.series : [] });
                setErrors(previous => ({ ...previous, history: '' }));
            })
            .catch(error => { if (!controller.signal.aborted) { setHistoryState({ range, series: [] }); setErrors(previous => ({ ...previous, history: error.message || 'Price history unavailable.' })); } })
            .finally(() => { if (!controller.signal.aborted) setLoading(previous => ({ ...previous, history: false })); });
        return () => controller.abort();
    }, [range, revision]);

    useEffect(() => {
        if (!address) return undefined;
        const controller = new AbortController();
        apiRequest(`/api/balance/${encodeURIComponent(address)}`, { signal: controller.signal })
            .then(data => {
                if (!/^\d+$/.test(String(data.balance?.balanceNano ?? '')) || data.balance.network !== APP_CONFIG.tonChainId) {
                    throw new Error('Balance response was invalid or from another network.');
                }
                setBalance(data.balance);
                setErrors(previous => ({ ...previous, balance: '' }));
            })
            .catch(error => { if (!controller.signal.aborted) { setBalance(null); setErrors(previous => ({ ...previous, balance: error.message || 'Balance unavailable.' })); } })
            .finally(() => { if (!controller.signal.aborted) setLoading(previous => ({ ...previous, balance: false })); });
        return () => controller.abort();
    }, [address, revision]);

    const visibleBalance = address && balance?.address && balance.address === address ? balance : null;
    return { health, market, history: historyState.range === range ? historyState.series : [], balance: visibleBalance, errors, loading: { ...loading, history: loading.history || historyState.range !== range }, refresh };
}
