export const IMPORT_SOURCE_KINDS = ['search_performance', 'keyword_positions', 'backlink_evidence'] as const;
export type ImportSourceKind = typeof IMPORT_SOURCE_KINDS[number];

export interface ProjectDataImportSummary {
  id: string;
  projectId: string | null;
  sourceKind: ImportSourceKind;
  fileName: string;
  headers: string[];
  rowCount: number;
  importedAt: string;
  expiresAt: string;
}

export interface ProjectDataImportRows {
  import: ProjectDataImportSummary;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export function isImportSourceKind(value: unknown): value is ImportSourceKind {
  return IMPORT_SOURCE_KINDS.includes(value as ImportSourceKind);
}
