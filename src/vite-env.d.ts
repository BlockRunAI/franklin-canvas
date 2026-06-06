/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYMENT_MODE?: string;
  readonly VITE_WALLETCONNECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
