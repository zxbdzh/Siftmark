import type { SiftmarkDatabase } from '../storage/database';
import type { CapturePreferenceRecord } from '../storage/schema';
import type {
  CapturePreference,
  CapturePreferenceKind,
  CaptureSession
} from './types';

export interface CapturePreferenceRepository {
  get(id: string): Promise<CapturePreference | null>;
  list(kind?: CapturePreferenceKind): Promise<CapturePreference[]>;
  listMatching(url: string, title: string): Promise<CapturePreference[]>;
  put(preference: CapturePreference): Promise<void>;
  remove(id: string): Promise<void>;
}

export class DexieCapturePreferenceRepository
  implements CapturePreferenceRepository
{
  constructor(private readonly database: SiftmarkDatabase) {}

  async get(id: string): Promise<CapturePreference | null> {
    const record = await this.database.capturePreferences.get(id);
    return record ? fromRecord(record) : null;
  }

  async list(kind?: CapturePreferenceKind): Promise<CapturePreference[]> {
    const rows = kind
      ? await this.database.capturePreferences.where('kind').equals(kind).toArray()
      : await this.database.capturePreferences.orderBy('updatedAt').reverse().toArray();
    return rows
      .map(fromRecord)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async listMatching(url: string, title: string): Promise<CapturePreference[]> {
    const domain = domainOf(url);
    if (!domain) return [];
    const rows = await this.database.capturePreferences
      .where('domain')
      .equals(domain)
      .toArray();
    return rows
      .map(fromRecord)
      .filter(
        (preference) =>
          (!preference.urlPrefix || url.startsWith(preference.urlPrefix)) &&
          (!preference.titleIncludes ||
            title
              .toLocaleLowerCase()
              .includes(preference.titleIncludes.toLocaleLowerCase()))
      )
      .sort(
        (left, right) =>
          Number(right.kind === 'fixed-rule') -
            Number(left.kind === 'fixed-rule') ||
          right.updatedAt - left.updatedAt
      );
  }

  async put(preference: CapturePreference): Promise<void> {
    await this.database.capturePreferences.put(toRecord(preference));
  }

  async remove(id: string): Promise<void> {
    await this.database.capturePreferences.delete(id);
  }
}

export interface CapturePreferenceDecision {
  id: string;
  session: CaptureSession;
  decision: 'allow' | 'reject' | 'agent-adjustment';
  explicitRule?: boolean;
  createdAt: number;
}

export function preferenceFromDecision(
  input: CapturePreferenceDecision
): CapturePreference | null {
  const { session } = input;
  if (!session.plan) return null;
  const domain = domainOf(session.sourceSnapshot.url ?? '');
  if (!domain) return null;
  const destinationPath = [
    ...session.plan.destination.path.map((folder) => folder.title),
    ...session.plan.destination.newFolders
  ];
  return {
    id: input.id,
    kind: input.explicitRule ? 'fixed-rule' : 'soft',
    domain,
    action: input.decision === 'reject' ? 'avoid-folder' : 'prefer-folder',
    ...(session.plan.destination.newFolders.length === 0
      ? { destinationFolderId: session.plan.destination.folderId }
      : {}),
    destinationPath,
    source: input.explicitRule ? 'explicit-rule' : input.decision,
    sourceSessionId: session.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

export function isFixedRuleInstruction(message: string): boolean {
  const normalized = message.normalize('NFKC').replace(/\s+/g, '');
  return /(?:以后|今后|从今往后|下次).*(?:都|总是|一律).*(?:放|存|收藏|归类|移动)(?:到|进|在)?/.test(
    normalized
  );
}

function toRecord(preference: CapturePreference): CapturePreferenceRecord {
  return {
    id: preference.id,
    kind: preference.kind,
    domain: preference.domain,
    updatedAt: preference.updatedAt,
    payload: preference as unknown as Record<string, unknown>
  };
}

function fromRecord(record: CapturePreferenceRecord): CapturePreference {
  return record.payload as unknown as CapturePreference;
}

function domainOf(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase();
  } catch {
    return '';
  }
}
