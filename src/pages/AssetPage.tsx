import App from '../App';

interface AssetPageProps {
  apiBase: string;
}

export function AssetPage({ apiBase }: AssetPageProps) {
  return <App apiBase={apiBase} />;
}
