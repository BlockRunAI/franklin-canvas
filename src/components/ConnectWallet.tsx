import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Wallet } from 'lucide-react';
import { IS_BROWSER_PAY } from '../payments/mode';

// Web build only: connect a browser wallet so the visitor can pay x402 for their
// own generations. Hidden in the desktop build (which pays via the local wallet).
export default function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!IS_BROWSER_PAY) return null;

  if (isConnected && address) {
    return (
      <button
        type="button"
        className="canvas-add-btn canvas-wallet-btn is-connected"
        onClick={() => disconnect()}
        title={`Connected: ${address} — click to disconnect`}
      >
        <Wallet size={15} strokeWidth={1.75} aria-hidden />
        <span>{address.slice(0, 6)}…{address.slice(-4)}</span>
      </button>
    );
  }

  const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];
  return (
    <button
      type="button"
      className="canvas-add-btn canvas-wallet-btn"
      disabled={isPending || !injected}
      onClick={() => injected && connect({ connector: injected })}
      title="Connect a wallet to pay for generations"
    >
      <Wallet size={15} strokeWidth={1.75} aria-hidden />
      <span>{isPending ? 'Connecting…' : 'Connect Wallet'}</span>
    </button>
  );
}
