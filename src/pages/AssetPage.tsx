import App from '../App';

interface AssetPageProps {
  apiBase: string;
  symbol: string;
}

export function AssetPage({ apiBase, symbol }: AssetPageProps) {
  return <App apiBase={apiBase} expectedSymbol={symbol} />;
}
