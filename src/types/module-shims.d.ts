// Type shims for graphene SDK packages that ship without declarations.

declare module "@r-squared/rsquared-js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const key: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PublicKey: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PrivateKey: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const TransactionBuilder: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Apis: any;
}

declare module "@r-squared/rsquared-js-ws" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Apis: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const ChainConfig: any;
}

// Vite env variables injected at build time.
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  readonly VITE_REGISTRAR_URL?: string;
  readonly VITE_DEFAULT_WSS_NODE?: string;
  [key: string]: string | boolean | undefined;
}
