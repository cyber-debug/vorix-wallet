import React from 'react';
import ReactDOM from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { Buffer } from 'buffer';
import App from './App';
import { getTonConnectManifestUrl, shouldUseHashRouter } from './config';
import { RouterProvider } from './lib/router';

if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer;

ReactDOM.createRoot(document.getElementById('root')).render(
    <TonConnectUIProvider manifestUrl={getTonConnectManifestUrl()}>
        <RouterProvider mode={shouldUseHashRouter() ? 'hash' : 'browser'}>
            <App />
        </RouterProvider>
    </TonConnectUIProvider>
);
