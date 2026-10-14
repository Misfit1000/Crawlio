export type DomainSignalStatus = 'measured' | 'not_ranked' | 'unavailable';

export type ProviderSignalStatus = 'measured' | 'not_listed' | 'unavailable' | 'not_configured' | 'stale';

export interface ProviderEvidenceSummary {
  status: ProviderSignalStatus;
  fetchedAt: string | null;
  datasetDate: string | null;
  scope: 'domain' | 'host' | 'public_top_million';
}

export interface OpenPageRankHistoryPoint {
  date: string;
  score: number;
  estimated: boolean;
}

export interface OpenPageRankEvidence extends ProviderEvidenceSummary {
  source: 'Open PageRank';
  sourceUrl: 'https://openpagerank.keywordseverywhere.com/docs';
  domain: string;
  scope: 'domain' | 'host';
  score: number | null;
  scale: 10;
  rank: number | null;
  referringDomains: number | null;
  referringHosts: number | null;
  referringCountDefinition: 'authority_weighted_domains' | 'authority_filtered_hosts';
  estimated: boolean | null;
  history: OpenPageRankHistoryPoint[];
}

export interface TrancoEvidence extends ProviderEvidenceSummary {
  domain: string;
  scope: 'domain';
  history: WebRankHistoryPoint[];
}
export interface MajesticEvidence extends ProviderEvidenceSummary {
  domain: string;
  scope: 'public_top_million';
  found: boolean;
  globalRank: number | null;
  tldRank: number | null;
  referringSubnets: number | null;
  referringIps: number | null;
}

export interface WebRankHistoryPoint {
  date: string;
  rank: number;
}

export interface DomainSignalAttribution {
  label: string;
  url: string;
  license?: string;
}

export interface PublicLinkSignals {
  domain: string;
  found: boolean;
  globalRank: number | null;
  tldRank: number | null;
  referringSubnets: number | null;
  referringIps: number | null;
  datasetDate: string | null;
  fetchedAt: string;
  source: 'Majestic Million';
  sourceUrl: string;
  license: 'CC BY 3.0';
  scope: 'public_top_million';
  linkStatus: DomainSignalStatus;
  webRankStatus: DomainSignalStatus;
  webRank: number | null;
  previousWebRank: number | null;
  webRankChange: number | null;
  webRankHistory: WebRankHistoryPoint[];
  partial: boolean;
  attributions: DomainSignalAttribution[];
  openPageRank?: OpenPageRankEvidence;
  sources?: {
    openPageRank: ProviderEvidenceSummary;
    majesticMillion: ProviderEvidenceSummary;
    tranco: ProviderEvidenceSummary;
  };
}
