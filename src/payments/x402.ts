import { useState, useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { getAddress } from 'viem';
import { wagmiConfig } from '../lib/wagmi-config';

// Client-side x402 signing — ported verbatim from franklin-run. The visitor's
// wallet signs an EIP-3009 TransferWithAuthorization; the server never sees a
// key. Used by the web build so canvas generations are paid per-visitor.

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

interface PaymentRequirement {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface X402Response {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirement[];
  extensions?: Record<string, unknown>;
}

type PaymentStep = 'idle' | 'signing' | 'done' | 'error';

function createNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

export function useX402Payment() {
  const { address, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<PaymentStep>('idle');
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
  }, []);

  const createPayment = useCallback(
    async (
      requirements: PaymentRequirement,
      resource?: ResourceInfo,
    ): Promise<{ payload: string | null; error: string | null }> => {
      if (!address || !isConnected) {
        const msg = 'Wallet not connected';
        setError(msg);
        setStep('error');
        return { payload: null, error: msg };
      }

      setStep('signing');
      setError(null);

      try {
        const requiredChainId = parseInt(requirements.network.split(':')[1] || '8453');

        try {
          await switchChainAsync({ chainId: requiredChainId });
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
          const msg = 'Please switch to the Base network in your wallet and try again';
          setError(msg);
          setStep('error');
          return { payload: null, error: msg };
        }

        let walletClient;
        try {
          walletClient = await getWalletClient(wagmiConfig);
        } catch {
          const msg = 'Please switch to the Base network in your wallet and try again';
          setError(msg);
          setStep('error');
          return { payload: null, error: msg };
        }
        if (!walletClient) {
          const msg = 'Could not get wallet. Please reconnect.';
          setError(msg);
          setStep('error');
          return { payload: null, error: msg };
        }

        const nonce = createNonce();
        const now = Math.floor(Date.now() / 1000);
        const validAfter = now - 600;
        const validBefore = now + (requirements.maxTimeoutSeconds || 300);
        const chainId = requiredChainId;

        const domain = {
          name: requirements.extra?.name || 'USD Coin',
          version: requirements.extra?.version || '2',
          chainId,
          verifyingContract: getAddress(requirements.asset || USDC_BASE),
        } as const;

        const message = {
          from: getAddress(address),
          to: getAddress(requirements.payTo),
          value: BigInt(requirements.amount),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        };

        const signature = await Promise.race([
          walletClient.signTypedData({
            account: address,
            domain,
            types: authorizationTypes,
            primaryType: 'TransferWithAuthorization',
            message,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Wallet signature timed out — please try again.')), 120_000),
          ),
        ]);

        const payload = {
          x402Version: 2,
          resource: resource || {
            url: '/api/gw/v1/images/generations',
            description: 'Franklin Canvas',
            mimeType: 'application/json',
          },
          accepted: {
            scheme: requirements.scheme,
            network: requirements.network,
            amount: requirements.amount,
            asset: getAddress(requirements.asset),
            payTo: getAddress(requirements.payTo),
            maxTimeoutSeconds: requirements.maxTimeoutSeconds || 300,
            extra: requirements.extra,
          },
          payload: {
            signature,
            authorization: {
              from: getAddress(address),
              to: getAddress(requirements.payTo),
              value: requirements.amount,
              validAfter: validAfter.toString(),
              validBefore: validBefore.toString(),
              nonce,
            },
          },
          extensions: {},
        };

        setStep('done');
        return { payload: btoa(JSON.stringify(payload)), error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Signing failed';
        setError(msg);
        setStep('error');
        return { payload: null, error: msg };
      }
    },
    [address, isConnected, switchChainAsync],
  );

  const makePayment = useCallback(
    async (requirements: X402Response): Promise<{ payload: string | null; error: string | null }> => {
      const paymentReq = requirements.accepts[0];
      if (!paymentReq) {
        const msg = 'No payment requirements found';
        setError(msg);
        setStep('error');
        return { payload: null, error: msg };
      }
      return createPayment(paymentReq, requirements.resource);
    },
    [createPayment],
  );

  return { isConnected, step, error, makePayment, createPayment, reset };
}

// Parse x402 requirements from a 402 response's header (base64-encoded JSON).
export function parseX402FromResponse(response: Response): X402Response | null {
  const paymentRequired =
    response.headers.get('payment-required') || response.headers.get('X-Payment-Required');
  if (!paymentRequired) return null;
  try {
    return JSON.parse(atob(paymentRequired));
  } catch {
    return null;
  }
}
