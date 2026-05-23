import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ArrowDownToLine, ArrowUpFromLine, ExternalLink, TrendingUp, Activity } from 'lucide-react';
import type { WalletInfo, Transaction } from '../types';
import { getWallet, listTransactions } from '../api/franklin';

export default function WalletView() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showSend, setShowSend] = useState(false);

  useEffect(() => {
    Promise.all([getWallet(), listTransactions()])
      .then(([w, t]) => {
        setWallet(w);
        setTxs(t);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <div className="view wallet-view">
        <div className="card error-card">
          <h2>Wallet</h2>
          <p className="error">Could not reach Franklin daemon: {err}</p>
          <p className="hint">Start it with <code>franklin daemon</code> or <code>npm run mock</code>.</p>
        </div>
      </div>
    );
  }

  if (!wallet || !txs) return <div className="view"><p>Loading…</p></div>;

  const copy = () => {
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const maxSpend = Math.max(...wallet.spendByCategory.map((c) => c.usd), 0.001);

  return (
    <div className="view wallet-view">
      {/* Hero card */}
      <div className="wallet-hero">
        <div className="wallet-hero-left">
          <div className="wallet-balance-label">USDC balance · {wallet.network}</div>
          <div className="wallet-balance">
            <span className="wallet-balance-currency">$</span>
            {wallet.balanceUsdc.toFixed(2)}
          </div>
          <div className="wallet-address-row">
            <code className="wallet-address" aria-label={`Wallet address ${wallet.address}`}>{wallet.address}</code>
            <button
              className="icon-btn"
              onClick={copy}
              aria-label={copied ? 'Address copied' : 'Copy address'}
              title={copied ? 'Copied!' : 'Copy address'}
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            </button>
            <a
              className="icon-btn"
              href={`https://basescan.org/address/${wallet.address}`}
              target="_blank"
              rel="noreferrer"
              aria-label="View address on Basescan"
              title="View on Basescan"
            >
              <ExternalLink size={14} aria-hidden />
            </a>
          </div>
        </div>
        <div className="wallet-hero-right">
          <button className="wallet-action" onClick={() => setShowReceive((s) => !s)}>
            <ArrowDownToLine size={16} />
            Receive
          </button>
          <button className="wallet-action" onClick={() => setShowSend((s) => !s)}>
            <ArrowUpFromLine size={16} />
            Send
          </button>
        </div>
      </div>

      {showReceive && (
        <div className="card receive-card">
          <h3>Receive USDC on Base</h3>
          <div className="receive-grid">
            <div className="qr-wrap">
              <QRCodeSVG
                value={wallet.address}
                size={160}
                bgColor="#ffffff"
                fgColor="#0d0d0e"
                level="M"
                includeMargin
              />
            </div>
            <div>
              <p className="hint">Send any amount of USDC on Base to this address. Funds appear within a few seconds.</p>
              <div className="kv mono"><span>Network</span><strong>Base</strong></div>
              <div className="kv mono"><span>Token</span><strong>USDC (0x833...e96)</strong></div>
              <div className="kv mono"><span>Min</span><strong>0.001 USDC</strong></div>
            </div>
          </div>
        </div>
      )}

      {showSend && (
        <div className="card">
          <h3>Send USDC</h3>
          <form className="send-form" onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <label htmlFor="send-recipient">Recipient</label>
              <input
                id="send-recipient"
                type="text"
                placeholder="0x..."
                autoComplete="off"
                inputMode="text"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="send-amount">Amount (USDC)</label>
              <input
                id="send-amount"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                inputMode="decimal"
              />
            </div>
            <button type="submit" className="btn-primary" disabled>
              Sign & send (TODO)
            </button>
          </form>
        </div>
      )}

      {/* Stats row */}
      <div className="stats-row">
        <div className="card stat">
          <div className="stat-label"><Activity size={14} /> Spent (24h)</div>
          <div className="stat-value">${wallet.recentSpendUsd.toFixed(3)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label"><TrendingUp size={14} /> Transactions</div>
          <div className="stat-value">{txs.length}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Average / call</div>
          <div className="stat-value">
            ${txs.length > 0 ? (txs.filter((t) => t.type === 'spend').reduce((s, t) => s + t.amountUsd, 0) / txs.length).toFixed(4) : '0.0000'}
          </div>
        </div>
      </div>

      <div className="wallet-cols">
        {/* Spend breakdown */}
        <div className="card">
          <h3>Spend by category (7d)</h3>
          <ul className="bar-list">
            {wallet.spendByCategory.map((c) => (
              <li key={c.category}>
                <div className="bar-label">
                  <span>{c.category}</span>
                  <span className="mono">${c.usd.toFixed(4)}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(c.usd / maxSpend) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Transactions */}
        <div className="card">
          <h3>Recent transactions</h3>
          <table className="table tx-table">
            <thead>
              <tr><th></th><th>Description</th><th>Amount</th><th>Tx</th></tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className={`tx-pill tx-${t.type}`}>
                      {t.type === 'spend' ? '−' : t.type === 'topup' ? '+' : '↩'}
                    </span>
                  </td>
                  <td>
                    <div>{t.description}</div>
                    <div className="tx-meta">{new Date(t.ts).toLocaleString()}</div>
                  </td>
                  <td className={`mono ${t.type === 'spend' ? 'amt-neg' : 'amt-pos'}`}>
                    {t.type === 'spend' ? '−' : '+'}${t.amountUsd.toFixed(4)}
                  </td>
                  <td>
                    {t.txHash && (
                      <a
                        className="icon-btn small"
                        href={`https://basescan.org/tx/${t.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View transaction ${t.txHash} on Basescan`}
                        title="View on Basescan"
                      >
                        <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
