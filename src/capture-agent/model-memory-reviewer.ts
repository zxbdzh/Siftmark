import type { AiAdapterRegistry } from '../ai/adapter-registry';
import type { ProfileRepository } from '../ai/profiles/profile-repository';
import { selectProfileForCapability } from '../ai/profiles/profile-selector';
import type { AiCaptureReviewContext } from '../ai/types';
import type { ChromeSettingsRepository } from '../settings/settings-repository';
import type { CaptureMemoryReviewer } from './sleep-review';

export interface ModelCaptureMemoryReviewerDependencies {
  profiles: Pick<ProfileRepository, 'list'>;
  settings: Pick<ChromeSettingsRepository, 'getProfileAssignments'>;
  adapters: AiAdapterRegistry;
}

export class ModelCaptureMemoryReviewer implements CaptureMemoryReviewer {
  constructor(
    private readonly dependencies: ModelCaptureMemoryReviewerDependencies
  ) {}

  async review(context: AiCaptureReviewContext) {
    const [profiles, assignments] = await Promise.all([
      this.dependencies.profiles.list(),
      this.dependencies.settings.getProfileAssignments()
    ]);
    const profile = selectProfileForCapability(
      profiles,
      'classify',
      assignments.agent ?? assignments.classify
    );
    if (!profile) throw new Error('请先配置并启用 Agent 分类模型');
    const adapter = this.dependencies.adapters.get(profile.protocol);
    if (!adapter?.reviewCaptureHistory)
      throw new Error('当前模型协议不支持睡眠回顾');
    return adapter.reviewCaptureHistory(
      profile,
      context,
      new AbortController().signal
    );
  }
}
