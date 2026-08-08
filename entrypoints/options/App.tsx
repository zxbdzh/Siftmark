import { useMemo } from 'react';
import { ChromeProfileRepository } from '../../src/ai/profiles/profile-repository';
import { ModelProfilesSection } from '../../src/ui/options/ModelProfilesSection';
import { AppearanceSection } from '../../src/ui/options/AppearanceSection';
import { PermissionsSection } from '../../src/ui/options/PermissionsSection';
import { RulesSection } from '../../src/ui/options/RulesSection';
import { SpecialFoldersSection } from '../../src/ui/options/SpecialFoldersSection';
import { PromptRulesSection } from '../../src/ui/options/PromptRulesSection';
import { IncognitoSection } from '../../src/ui/options/IncognitoSection';
import { AiUsageSection } from '../../src/ui/options/AiUsageSection';
export default function App(){ const profiles=useMemo(()=>new ChromeProfileRepository(browser.storage.local),[]); return <main><header><strong className="brand-type">Siftmark</strong><h1>设置</h1></header><ModelProfilesSection repository={profiles}/><RulesSection/><PermissionsSection/><AppearanceSection/><SpecialFoldersSection/><PromptRulesSection/><IncognitoSection/><AiUsageSection metrics={[]}/></main>; }
