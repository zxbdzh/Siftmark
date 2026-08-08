import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuickSave } from '../../../src/ui/popup/QuickSave';
describe('QuickSave', () => { it('shows the current page and save command', () => { render(<QuickSave service={{} as never} tab={{ title: '示例', url: 'https://a.test' }}/>); expect(screen.getByRole('button', { name: /保存书签/ })).toBeEnabled(); expect(screen.getByText('示例')).toBeInTheDocument(); }); });
