import type { SiftmarkDatabase } from '../storage/database';
import type {
  SpecialFolderPlacement,
  SpecialFolderPlacementRepository
} from './recycle-service';

export class DexieSpecialFolderPlacementRepository implements SpecialFolderPlacementRepository {
  constructor(private readonly database: SiftmarkDatabase) {}

  get(bookmarkId: string): Promise<SpecialFolderPlacement | null> {
    return this.database.specialFolderPlacements
      .get(bookmarkId)
      .then((value) => value ?? null);
  }

  list(): Promise<SpecialFolderPlacement[]> {
    return this.database.specialFolderPlacements.toArray();
  }

  async put(value: SpecialFolderPlacement): Promise<void> {
    await this.database.specialFolderPlacements.put(value);
  }

  async delete(bookmarkId: string): Promise<void> {
    await this.database.specialFolderPlacements.delete(bookmarkId);
  }

  listRecycledBefore(cutoff: number): Promise<SpecialFolderPlacement[]> {
    return this.database.specialFolderPlacements
      .where('state')
      .equals('recycled')
      .and((row) => row.movedAt < cutoff)
      .sortBy('movedAt');
  }
}
