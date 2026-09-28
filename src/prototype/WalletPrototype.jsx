import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useTonConnectModal, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { Address, toNano } from '@ton/core';
import { LuArrowDownLeft, LuArrowRight, LuArrowUpRight, LuBell, LuCheck, LuChevronDown, LuCircleHelp, LuCopy, LuDownload, LuEye, LuEyeOff, LuHistory, LuLayoutDashboard, LuMenu, LuRefreshCw, LuSearch, LuSettings, LuShieldCheck, LuWallet, LuX } from 'react-icons/lu';
import { APP_CONFIG } from '../config';
import { useWalletBackend } from '../hooks/useWalletBackend';
import { useWalletActivity } from '../hooks/useWalletActivity';
import { addWalletActivity } from '../lib/activity';
import { apiRequest } from '../lib/api';
import { Link } from '../lib/router';
import { useRouter } from '../lib/router-context';
import './prototype.css';

const navigation = [
    { label: 'Overview', path: '/', icon: LuLayoutDashboard },
    { label: 'Assets', path: '/assets', icon: LuWallet },
    { label: 'Market', path: '/trade', icon: LuArrowUpRight },
    { label: 'Activity', path: '/activity', icon: LuHistory },
];
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const usd = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const shortAddress = value => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'No wallet connected';
const balanceTon = balance => balance ? Number(BigInt(balance.balanceNano)) / 1e9 : null;

function PriceChart({ series, range, loading, error }) {
    if (loading) return <div className="chart-state">Loading TON price history…</div>;
    if (error || series.length < 2) return <div className="chart-state">{error || 'Price history is unavailable.'}</div>;
    const prices = series.map(point => point.priceUsd);
    const min = Math.min(...prices);
    const span = Math.max(...prices) - min || 1;
    const points = prices.map((price, index) => `${index * 700 / (prices.length - 1)},${135 - (price - min) / span * 105}`).join(' ');
    return <div className="portfolio-chart"><svg viewBox="0 0 700 165" preserveAspectRatio="none" role="img" aria-label={`TON price over ${range}`}><defs><linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffb594" stopOpacity="0.26" /><stop offset="100%" stopColor="#ffb594" stopOpacity="0" /></linearGradient></defs><motion.polygon key={`fill-${range}`} points={`0,165 ${points} 700,165`} fill="url(#price-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} /><motion.polyline key={range} points={points} fill="none" stroke="#ffb594" strokeWidth="2.5" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1 }} /></svg><div className="chart-dates"><span>{new Date(series[0].timestamp).toLocaleDateString()}</span><span>TON / USD · CoinGecko</span><span>{new Date(series.at(-1).timestamp).toLocaleDateString()}</span></div></div>;
}

function Modal({ title, children, onClose }) {
    const ref = useRef(null);
    useEffect(() => {
        const previous = document.activeElement;
        ref.current?.focus();
        const onKey = event => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus(); };
    }, [onClose]);
    return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}><motion.section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="modal" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={event => event.stopPropagation()}><div className="panel-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><LuX /></button></div>{children}</motion.section></motion.div>;
}

function QuotePanel({ market }) {
    const [side, setSide] = useState('buy');
    const [amount, setAmount] = useState('');
    const [quote, setQuote] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    async function preview(event) {
        event.preventDefault();
        setLoading(true); setError(''); setQuote(null);
        try {
            const data = await apiRequest('/api/quotes/preview', { params: { side, amount } });
            if (data.quote?.kind !== 'estimate' || data.quote.executable !== false) throw new Error('Unexpected quote response.');
            setQuote(data.quote);
        } catch (failure) { setError(failure.message || 'Quote unavailable.'); }
        finally { setLoading(false); }
    }
    return <section className="panel swap-panel"><div className="panel-heading"><h2>TON price estimate</h2><span className="subtle-icon"><LuArrowUpRight /></span></div><p className="panel-description">Mainnet market reference. This does not place an order.</p><form onSubmit={preview}><div className="activity-filters quote-tabs"><button type="button" className={side === 'buy' ? 'active' : ''} onClick={() => { setSide('buy'); setQuote(null); }}>Buy</button><button type="button" className={side === 'sell' ? 'active' : ''} onClick={() => { setSide('sell'); setQuote(null); }}>Sell</button></div><label className="form-field">Amount in TON<input type="number" min="0.000000001" max="1000000" step="any" value={amount} onChange={event => { setAmount(event.target.value); setQuote(null); }} placeholder="0.00" required /></label><div className="swap-rate"><span>TON price</span><span>{market ? usd(market.priceUsd) : 'Unavailable'}</span></div>{quote && <div className="quote-result"><span>Estimated {side === 'buy' ? 'cost' : 'proceeds'}</span><strong>{usd(quote.totalUsd)}</strong><small>Includes estimated fee {usd(quote.feeUsd)} and slippage {usd(quote.slippageUsd)}. Valid only as an estimate.</small></div>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button dark full" disabled={loading || !market}>{loading ? 'Loading estimate…' : 'Preview estimate'}<LuArrowRight /></button></form><div className="swap-footnote"><LuShieldCheck /> Quotes cannot be executed here</div></section>;
}

function ActivityList({ entries }) {
    if (!entries.length) return <div className="empty-state">No locally saved wallet approvals yet.</div>;
    return <div className="transactions">{entries.map(entry => <div className="transaction" key={entry.id}><div className="transaction-icon sent"><LuArrowUpRight /></div><div className="transaction-info"><strong>{entry.title || 'Transfer signed in wallet'}</strong><span>{entry.meta}</span></div><div className="transaction-value"><strong>{entry.value || ''}</strong><span>{new Date(entry.timestamp).toLocaleString()}</span></div></div>)}</div>;
}

export default function WalletPrototype() {
    const { pathname } = useRouter();
    const wallet = useTonWallet();
    const { open } = useTonConnectModal();
    const [tonConnectUI] = useTonConnectUI();
    const address = wallet?.account?.address || '';
    const chainMatches = !wallet || String(wallet.account.chain) === APP_CONFIG.tonChainId;
    const [range, setRange] = useState('1D');
    const { health, market, history, balance, errors, loading, refresh } = useWalletBackend(chainMatches ? address : '', range);
    const activity = useWalletActivity(address);
    const [hidden, setHidden] = useState(false);
    const [query, setQuery] = useState('');
    const [modal, setModal] = useState(null);
    const [menu, setMenu] = useState(false);
    const [toast, setToast] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');
    const ton = balanceTon(balance);
    const totalUsd = APP_CONFIG.tonNetwork === 'mainnet' && ton !== null && market ? ton * market.priceUsd : null;
    const marketChange = market?.change24h;
    const title = pathname === '/assets' ? 'Assets' : pathname === '/trade' ? 'Market' : pathname === '/activity' ? 'Activity' : pathname === '/profile' ? 'Settings' : 'Overview';
    const visibleActivity = useMemo(() => activity.filter(entry => entry.type === 'transfer'), [activity]);

    useEffect(() => {
        const initializeTelegram = () => {
            window.Telegram?.WebApp?.ready?.();
            window.Telegram?.WebApp?.expand?.();
        };
        const script = document.getElementById('telegram-sdk');
        script?.addEventListener('load', initializeTelegram);
        initializeTelegram();
        return () => script?.removeEventListener('load', initializeTelegram);
    }, []);
    useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);

    async function connect() {
        try { await open(); } catch (error) { if (!String(error?.message).toLowerCase().includes('abort')) setToast(error.message || 'Could not open wallet connection.'); }
    }
    async function copyAddress() {
        if (!address) return;
        try { await navigator.clipboard.writeText(address); setToast('Wallet address copied.'); }
        catch { setToast('Clipboard is unavailable.'); }
    }
    async function send(event) {
        event.preventDefault();
        if (!wallet) { setModal(null); await connect(); return; }
        if (!chainMatches || !health || APP_CONFIG.demoMode) { setSendError(`Connect a wallet on ${APP_CONFIG.tonNetworkLabel} with the live API available.`); return; }
        setSending(true); setSendError('');
        const form = event.currentTarget;
        const fields = new FormData(form);
        try {
            const data = await apiRequest('/api/transfer/prepare', { method: 'POST', body: { senderAddress: address, walletChainId: String(wallet.account.chain), recipient: String(fields.get('recipient')), amount: String(fields.get('amount')), memo: String(fields.get('memo') || '') } });
            const draft = data.transferDraft;
            if (draft.network !== APP_CONFIG.tonChainId || draft.senderAddress !== Address.parse(address).toRawString() || !Address.parse(draft.recipient).equals(Address.parse(String(fields.get('recipient')))) || draft.amountNano !== toNano(String(fields.get('amount'))).toString() || draft.validUntil <= Math.floor(Date.now() / 1000)) throw new Error('Prepared transfer does not match the submitted details.');
            await tonConnectUI.sendTransaction({ validUntil: draft.validUntil, network: draft.network, from: address, messages: [{ address: draft.recipient, amount: draft.amountNano, ...(draft.payload ? { payload: draft.payload } : {}) }] });
            addWalletActivity(address, { type: 'transfer', title: 'Transfer signed in wallet', meta: `${draft.amountTon} TON to ${shortAddress(draft.recipient)}`, value: APP_CONFIG.tonNetworkLabel });
            setModal(null); setToast('Wallet signed the transfer. Network confirmation may take time.'); refresh();
        } catch (error) { setSendError(error.message || 'Transfer could not be prepared or signed.'); }
        finally { setSending(false); }
    }
    function exportActivity() {
        const csvValue = value => `"${String(value ?? '').replaceAll('"', '""').replace(/^[=+@-]/, "'$&")}"`;
        const rows = [['Title', 'Details', 'Network', 'Date'], ...visibleActivity.map(entry => [entry.title, entry.meta, entry.value, entry.timestamp])];
        const blob = new Blob([rows.map(row => row.map(csvValue).join(',')).join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vorix-local-activity.csv'; anchor.click(); URL.revokeObjectURL(url);
    }
    const marketStatus = loading.market ? 'Loading market data…' : errors.market ? 'Market unavailable' : market?.isStale ? 'Cached market data' : 'Live market data';
    const balanceLabel = hidden ? '••••••' : !wallet ? '—' : !chainMatches ? 'Wrong network' : loading.balance && !balance ? 'Loading…' : ton === null ? 'Unavailable' : APP_CONFIG.tonNetwork === 'testnet' ? `${nf.format(ton)} TON` : totalUsd === null ? 'Price unavailable' : usd(totalUsd);
    const assetMatches = 'ton toncoin'.includes(query.trim().toLowerCase());

    return <MotionConfig reducedMotion="user"><div className="wallet-app"><h1 className="sr-only">VORIX Wallet</h1>
        {menu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenu(false)} />}
        <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}><Link to="/" className="brand" onClick={() => setMenu(false)}><span className="brand-mark">v<span>↗</span></span>vorix<span className="brand-period">.</span></Link><div className="workspace-label">TON WALLET</div><nav className="main-nav">{navigation.map(item => <Link key={item.path} to={item.path} onClick={() => setMenu(false)} className={`nav-item ${pathname === item.path ? 'active' : ''}`}><item.icon /><span>{item.label}</span></Link>)}</nav><div className="sidebar-bottom"><div className="network-note"><span className="network-dot" />{APP_CONFIG.tonNetworkLabel}<span className="sidebar-network-source">TON</span></div><Link to="/profile" className="nav-item" onClick={() => setMenu(false)}><LuSettings />Settings</Link><button className="nav-item" onClick={() => { setMenu(false); setModal('help'); }}><LuCircleHelp />Help & support</button><div className="sidebar-divider" /><button className="account-switch" onClick={() => { setMenu(false); setModal('wallet'); }}><span className="avatar">{wallet ? 'W' : '?'}</span><span><strong>{wallet ? 'Connected wallet' : 'Connect wallet'}</strong><small>{shortAddress(address)}</small></span><LuChevronDown /></button></div></aside>
        <nav className="mobile-bottom-nav" aria-label="Main navigation">{navigation.map(item => <Link key={item.path} to={item.path} className={`mobile-nav-item ${pathname === item.path ? 'active' : ''}`}><item.icon /><span>{item.label === 'Overview' ? 'Home' : item.label}</span></Link>)}</nav>
        <div className="app-body"><header className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMenu(true)}><LuMenu /></button><span>Wallet</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div><div className="topbar-actions"><span className="demo-badge"><span />{APP_CONFIG.demoMode ? 'Demo mode' : APP_CONFIG.tonNetworkLabel}</span><button className="icon-button notification-button" aria-label="Recent activity" onClick={() => setModal('notifications')}><LuBell /></button><button className="avatar top-avatar" aria-label="Open account" onClick={() => setModal('wallet')}>{wallet ? 'W' : '?'}</button></div></header>
        <main className="main-content"><div className="page-heading"><div><div className="eyebrow">{APP_CONFIG.tonNetworkLabel.toUpperCase()} · TON</div><h1>{title === 'Overview' ? 'Your wallet at a glance.' : title === 'Assets' ? 'Your TON balance.' : title === 'Market' ? 'TON market.' : title === 'Activity' ? 'Your activity.' : 'Wallet settings.'}</h1><p>{title === 'Overview' ? 'Connected balance and market data in one place.' : title === 'Assets' ? 'Your connected wallet’s TON balance.' : title === 'Market' ? 'Current TON pricing and informational estimates.' : title === 'Activity' ? 'Wallet approvals saved in this browser.' : 'Connection, network, and display preferences.'}</p></div><button className="wallet-selector" onClick={() => setModal('wallet')}><span className="wallet-selector-icon"><LuWallet /></span><span><strong>{wallet ? 'Connected wallet' : 'Connect wallet'}</strong><small>{shortAddress(address)} <span className="tiny-dot" /> {APP_CONFIG.tonNetworkLabel}</small></span><LuChevronDown /></button></div>
        <AnimatePresence mode="wait"><motion.div key={pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
        {pathname === '/' && <div className="dashboard-grid"><div className="main-column"><section className="balance-panel"><div className="balance-top"><div><div className="balance-label">{APP_CONFIG.tonNetwork === 'testnet' ? 'Testnet TON balance' : 'TON balance in USD'} <button aria-label={hidden ? 'Show balance' : 'Hide balance'} onClick={() => setHidden(!hidden)}>{hidden ? <LuEyeOff /> : <LuEye />}</button></div><div className="balance-amount balance-amount-live">{balanceLabel}</div><div className="balance-change"><span>{ton === null ? 'Connect a wallet to see your balance' : `${hidden ? '••••' : nf.format(ton)} TON`}</span><span>{balance?.isStale ? 'Cached balance' : marketStatus}</span></div></div><span className="balance-decoration" aria-hidden="true">✳</span></div><div className="chart-toolbar"><span>Mainnet TON price · {market ? usd(market.priceUsd) : marketStatus}</span><div className="range-tabs">{['1D', '1W', '1M'].map(value => <button key={value} className={range === value ? 'selected' : ''} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}</div></div><PriceChart series={history} range={range} loading={loading.history} error={errors.history} /><div className="balance-actions"><button onClick={() => setModal('send')}><LuArrowUpRight />Send</button><button onClick={() => setModal('receive')}><LuArrowDownLeft />Receive</button><Link to="/trade"><LuArrowUpRight />Market</Link><button onClick={refresh}><LuRefreshCw />Refresh</button></div></section><section className="panel assets-panel"><div className="panel-heading"><h2>Assets</h2><Link className="text-link" to="/assets">View balance <LuArrowRight /></Link></div><div className="single-asset"><span className="ton-icon">◈</span><div><strong>Toncoin</strong><small>TON · {APP_CONFIG.tonNetworkLabel}</small></div><div className="asset-value"><strong>{hidden ? '••••' : ton === null ? '—' : `${nf.format(ton)} TON`}</strong><small>{market ? `Mainnet price ${usd(market.priceUsd)}` : 'Market unavailable'}</small></div></div>{errors.balance && wallet && <p className="form-error">{errors.balance}</p>}</section><section className="explore-banner"><div><span className="eyebrow">YOUR KEYS, YOUR WALLET</span><h2>Send from your connected wallet.</h2><p>Details are checked by the API before your wallet signs.</p><button className="text-link" onClick={() => setModal('send')}>Send TON <LuArrowRight /></button></div><div className="orbit-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="orbit-coin">◈</div></div></section></div><div className="right-column"><QuotePanel market={market} /><section className="panel activity-panel"><div className="panel-heading"><h2>Recent activity</h2><Link className="text-link" to="/activity">View all <LuArrowRight /></Link></div><ActivityList entries={visibleActivity.slice(0, 3)} /></section><div className="ownership-note"><LuShieldCheck /><div><strong>Wallet owned</strong><p>Transactions are approved in your wallet.</p></div></div></div></div>}
        {pathname === '/assets' && <><div className="asset-summary"><div><span>TON balance</span><strong>{hidden ? '••••' : ton === null ? '—' : nf.format(ton)}</strong></div><div><span>{APP_CONFIG.tonNetwork === 'testnet' ? 'TON market reference' : 'Estimated USD value'}</span><strong>{hidden ? '••••' : APP_CONFIG.tonNetwork === 'testnet' ? (market ? usd(market.priceUsd) : '—') : totalUsd === null ? '—' : usd(totalUsd)}</strong></div><div><span>TON 24h change</span><strong className={marketChange >= 0 ? 'up' : 'down'}>{marketChange == null ? '—' : `${marketChange >= 0 ? '+' : ''}${marketChange.toFixed(2)}%`}</strong></div></div><section className="panel"><div className="panel-heading"><h2>Wallet assets</h2><label className="search-field"><LuSearch /><input placeholder="Search" aria-label="Search assets" value={query} onChange={event => setQuery(event.target.value)} /></label></div>{assetMatches && <div className="single-asset"><span className="ton-icon">◈</span><div><strong>Toncoin</strong><small>TON · {market ? usd(market.priceUsd) : 'Price unavailable'}</small></div><div className="asset-value"><strong>{hidden ? '••••' : ton === null ? '—' : `${nf.format(ton)} TON`}</strong><small>{market ? `Mainnet price ${usd(market.priceUsd)}` : 'Market unavailable'}</small></div></div>}{!assetMatches && <div className="empty-state">No supported assets match your search.</div>}<p className="asset-note">This beta reads native TON only. Jetton balances are not available yet.</p></section></>}
        {pathname === '/trade' && <div className="trade-layout"><QuotePanel market={market} /><div className="trade-aside"><span className="eyebrow">MARKET CONTEXT</span><h2>Know the price before you move.</h2><p>{market ? `TON is ${usd(market.priceUsd)} with a ${market.change24h.toFixed(2)}% change over 24 hours.` : errors.market || 'Loading TON pricing…'} Prices come from CoinGecko mainnet market data. Testnet TON has no cash value. Estimates are informational and cannot be executed here.</p><div className="trade-facts"><span><LuShieldCheck />Quote fees and slippage shown upfront</span><span><LuWallet />Transfers use wallet signing</span></div></div></div>}
        {pathname === '/activity' && <section className="panel"><div className="panel-heading activity-heading"><h2>Local wallet approvals</h2><button className="button outline" onClick={exportActivity} disabled={!visibleActivity.length}><LuDownload />Export CSV</button></div><p className="activity-disclosure">This list records wallet approvals in this browser. It does not verify blockchain confirmation or include all wallet history.</p><ActivityList entries={visibleActivity} /></section>}
        {pathname === '/profile' && <section className="panel settings-panel"><h2>Wallet settings</h2><div className="setting-row"><div><strong>Connected wallet</strong><p>{shortAddress(address)}</p></div><button className="button outline" onClick={connect}>{wallet ? 'Switch' : 'Connect'}</button></div><div className="setting-row"><div><strong>Network</strong><p>App: {APP_CONFIG.tonNetworkLabel} · Wallet: {wallet?.account?.chain || 'Disconnected'}</p></div><span className="demo-badge">{chainMatches ? 'Matched' : 'Mismatch'}</span></div><div className="setting-row"><div><strong>Hide balances</strong><p>Conceal balance amounts on screen.</p></div><button className={`switch ${hidden ? 'on' : ''}`} role="switch" aria-checked={hidden} aria-label="Hide balances" onClick={() => setHidden(!hidden)}><span /></button></div><div className="setting-row"><div><strong>API status</strong><p>{errors.health || (health ? 'Connected' : 'Checking…')}</p></div><button className="button outline" onClick={refresh}><LuRefreshCw />Refresh</button></div></section>}
        </motion.div></AnimatePresence><footer className="page-footer"><span>VORIX Wallet</span><span>TON {APP_CONFIG.tonNetworkLabel} · {health ? 'API online' : 'API unavailable'}</span></footer></main></div>
        <AnimatePresence>{modal && <Modal title={{ send: 'Send TON', receive: 'Receive TON', wallet: 'Your wallet', notifications: 'Recent activity', help: 'About this wallet' }[modal]} onClose={() => setModal(null)}>
        {modal === 'send' && <form onSubmit={send}><p className="modal-copy">{wallet ? `Your wallet on ${APP_CONFIG.tonNetworkLabel} signs after the backend checks the transfer.` : 'Connect a wallet to send TON.'}</p><label className="form-field">Recipient TON address<input name="recipient" autoComplete="off" required placeholder="EQ…" disabled={!wallet} /></label><label className="form-field">Amount in TON<input name="amount" type="number" min="0.000000001" step="0.000000001" required placeholder="0.00" disabled={!wallet} /></label><label className="form-field">Memo (optional)<input name="memo" maxLength={120} placeholder="Add a note" disabled={!wallet} /></label>{sendError && <p className="form-error" role="alert">{sendError}</p>}<button className="button dark full" type="submit" disabled={sending || !chainMatches || APP_CONFIG.demoMode}>{sending ? 'Waiting for wallet…' : wallet ? 'Review in wallet' : 'Connect wallet'}<LuArrowRight /></button>{!chainMatches && <p className="form-error">Switch your wallet to {APP_CONFIG.tonNetworkLabel}.</p>}{APP_CONFIG.demoMode && <p className="form-error">Transfers are disabled in demo mode.</p>}</form>}
        {modal === 'receive' && <div className="receive-content"><div className="receive-symbol"><LuArrowDownLeft /></div><p>{wallet ? `Share this ${APP_CONFIG.tonNetworkLabel} wallet address to receive TON.` : 'Connect a wallet to see its receive address.'}</p>{wallet && <><div className="demo-address">{address}</div><button className="button dark full" onClick={copyAddress}><LuCopy />Copy address</button></>}{!wallet && <button className="button dark full" onClick={connect}>Connect wallet</button>}</div>}
        {modal === 'wallet' && <><div className="wallet-modal-account"><span className="avatar">{wallet ? 'W' : '?'}</span><div><strong>{wallet ? 'Connected wallet' : 'No wallet connected'}</strong><p>{shortAddress(address)} · {APP_CONFIG.tonNetworkLabel}</p></div>{wallet && <LuCheck />}</div><p className="modal-copy">{wallet ? 'Balances come from TON Center. Transfers are signed by your wallet.' : 'Connect through TON Connect to view your balance and send TON.'}</p><button className="button dark full" onClick={connect}>{wallet ? 'Switch wallet' : 'Connect wallet'}<LuArrowRight /></button>{wallet && <button className="button outline full secondary-modal-button" onClick={async () => { await tonConnectUI.disconnect(); setModal(null); }}>Disconnect</button>}</>}
        {modal === 'notifications' && <><p className="modal-copy">Recent wallet approvals saved in this browser.</p><ActivityList entries={visibleActivity.slice(0, 3)} /></>}
        {modal === 'help' && <div className="help-content"><h3>What data is shown?</h3><p>TON balance from TON Center and mainnet market prices from CoinGecko. Testnet TON has no cash value. Other tokens are not shown in this beta.</p><h3>Can I trade here?</h3><p>Quotes are estimates. This app does not execute swaps or purchases.</p><h3>How do transfers work?</h3><p>The backend validates details. Your connected wallet asks you to sign. A signature is not proof of blockchain confirmation.</p></div>}
        </Modal>}</AnimatePresence><AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}><span><LuCheck /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><LuX /></button></motion.div>}</AnimatePresence>
    </div></MotionConfig>;
}
