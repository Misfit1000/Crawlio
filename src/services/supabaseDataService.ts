import { getSupabaseBrowserClient } from '../lib/supabase/client';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: any;
}

export interface SavedKeyword {
  id: string;
  term: string;
  projectId?: string;
  group?: string;
  searchVolume: number;
  keywordDifficulty: number;
  cpc?: number;
  intent?: string;
  createdAt: any;
}

export interface Competitor {
  id: string;
  domainUrl: string;
  niche?: string;
  createdAt: any;
}

function clientOrNull() {
  return getSupabaseBrowserClient();
}

function assertClient() {
  const client = clientOrNull();
  if (!client) {
    throw new Error('Supabase browser configuration is missing.');
  }
  return client;
}

function toCamelRow(row: any) {
  return {
    ...row,
    userId: row.user_id ?? row.userId,
    projectId: row.project_id ?? row.projectId,
    domainUrl: row.domain_url ?? row.domainUrl,
    searchVolume: row.search_volume ?? row.searchVolume,
    keywordDifficulty: row.keyword_difficulty ?? row.keywordDifficulty,
    displayName: row.display_name ?? row.displayName,
    fullName: row.full_name ?? row.fullName,
    photoURL: row.photo_url ?? row.photoURL,
    platformName: row.platform_name ?? row.platformName,
    supportEmail: row.support_email ?? row.supportEmail,
    requireEmailVerification: row.require_email_verification ?? row.requireEmailVerification,
    publicRegistration: row.public_registration ?? row.publicRegistration,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function profileToRow(data: any) {
  return {
    email: data.email,
    username: data.username,
    display_name: data.displayName,
    full_name: data.fullName,
    bio: data.bio,
    photo_url: data.photoURL,
    role: data.role,
    plan: data.plan,
    updated_at: new Date().toISOString(),
  };
}

function keywordToRow(uid: string, data: Omit<SavedKeyword, 'id' | 'createdAt'>) {
  return {
    user_id: uid,
    term: data.term,
    project_id: data.projectId,
    group: data.group,
    search_volume: data.searchVolume,
    keyword_difficulty: data.keywordDifficulty,
    cpc: data.cpc,
    intent: data.intent,
  };
}

function competitorToRow(uid: string, data: Omit<Competitor, 'id' | 'createdAt'>) {
  return {
    user_id: uid,
    domain_url: data.domainUrl,
    niche: data.niche,
  };
}

export const initUserProfile = async (uid: string, data: any) => {
  const client = assertClient();
  const { data: existing, error: readError } = await client.from('user_profiles').select('id').eq('id', uid).maybeSingle();
  if (readError) throw readError;
  if (!existing) {
    const { error } = await client.from('user_profiles').insert({
      id: uid,
      email: data.email,
      display_name: data.displayName,
      plan: 'free',
      role: 'member',
    });
    if (error) throw error;
  }
};

export const getUserProfile = async (uid: string) => {
  const client = clientOrNull();
  if (!client) return null;
  const { data, error } = await client.from('user_profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data ? toCamelRow(data) : null;
};

export const updateUserProfileData = async (uid: string, data: any) => {
  const client = assertClient();
  const { error } = await client.from('user_profiles').upsert({
    id: uid,
    ...profileToRow(data),
  }, { onConflict: 'id' });
  if (error) throw error;
};

export const makeUserAdmin = async (uid: string) => {
  await updateUserRole(uid, 'admin');
};

export const getAllUsers = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('user_profiles').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const updateUserRole = async (uid: string, role: string) => {
  const client = assertClient();
  const { error } = await client.from('user_profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', uid);
  if (error) throw error;
};

export const deleteUserDoc = async (uid: string) => {
  const client = assertClient();
  const { error } = await client.from('user_profiles').delete().eq('id', uid);
  if (error) throw error;
};

export const getAllProjects = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('projects').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const getAllKeywords = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('keywords').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const getAllCompetitors = async () => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('competitors').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow);
};

export const deleteAnyDocument = async (path: string) => {
  const client = assertClient();
  const [, , collectionName, id] = path.split('/');
  const tableByCollection: Record<string, string> = {
    projects: 'projects',
    keywords: 'keywords',
    competitors: 'competitors',
  };
  const table = tableByCollection[collectionName];
  if (!table || !id) throw new Error(`Unsupported data path: ${path}`);
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) throw error;
};

export const getPlatformSettings = async () => {
  const client = clientOrNull();
  if (!client) {
    return {
      platformName: 'SEOIntel Audit',
      supportEmail: 'support@keywordintelligence.com',
      requireEmailVerification: false,
      publicRegistration: true,
    };
  }
  const { data, error } = await client.from('platform_settings').select('*').eq('id', 'settings').maybeSingle();
  if (error) throw error;
  return data ? toCamelRow(data) : {
    platformName: 'SEOIntel Audit',
    supportEmail: 'support@keywordintelligence.com',
    requireEmailVerification: false,
    publicRegistration: true,
  };
};

export const updatePlatformSettings = async (data: any) => {
  const client = assertClient();
  const { error } = await client.from('platform_settings').upsert({
    id: 'settings',
    platform_name: data.platformName,
    support_email: data.supportEmail,
    require_email_verification: data.requireEmailVerification,
    public_registration: data.publicRegistration,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
};

export const getProjects = async (uid: string): Promise<Project[]> => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('projects').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow) as Project[];
};

export const addProject = async (uid: string, data: Omit<Project, 'id' | 'createdAt'>) => {
  const client = assertClient();
  const { data: inserted, error } = await client
    .from('projects')
    .insert({ user_id: uid, name: data.name, description: data.description })
    .select('*')
    .single();
  if (error) throw error;
  return toCamelRow(inserted) as Project;
};

export const deleteProject = async (uid: string, projectId: string) => {
  const client = assertClient();
  const { error } = await client.from('projects').delete().eq('user_id', uid).eq('id', projectId);
  if (error) throw error;
};

export const getSavedKeywords = async (uid: string): Promise<SavedKeyword[]> => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('keywords').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow) as SavedKeyword[];
};

export const addSavedKeyword = async (uid: string, data: Omit<SavedKeyword, 'id' | 'createdAt'>) => {
  const client = assertClient();
  const { data: inserted, error } = await client.from('keywords').insert(keywordToRow(uid, data)).select('*').single();
  if (error) throw error;
  return toCamelRow(inserted) as SavedKeyword;
};

export const deleteSavedKeyword = async (uid: string, keywordId: string) => {
  const client = assertClient();
  const { error } = await client.from('keywords').delete().eq('user_id', uid).eq('id', keywordId);
  if (error) throw error;
};

export const getCompetitors = async (uid: string): Promise<Competitor[]> => {
  const client = clientOrNull();
  if (!client) return [];
  const { data, error } = await client.from('competitors').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toCamelRow) as Competitor[];
};

export const addCompetitor = async (uid: string, data: Omit<Competitor, 'id' | 'createdAt'>) => {
  const client = assertClient();
  const { data: inserted, error } = await client.from('competitors').insert(competitorToRow(uid, data)).select('*').single();
  if (error) throw error;
  return toCamelRow(inserted) as Competitor;
};

export const deleteCompetitor = async (uid: string, competitorId: string) => {
  const client = assertClient();
  const { error } = await client.from('competitors').delete().eq('user_id', uid).eq('id', competitorId);
  if (error) throw error;
};
