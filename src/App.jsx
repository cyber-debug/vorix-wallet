import React from 'react';
import WalletPrototype from './prototype/WalletPrototype';
import AppErrorBoundary from './components/AppErrorBoundary';

export default function App() {
    return <AppErrorBoundary><WalletPrototype /></AppErrorBoundary>;
}
