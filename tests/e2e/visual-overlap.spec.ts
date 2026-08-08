import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/extension';
import { completeOnboarding, createRootFolder } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('keeps controls reachable, text fitted, and pages free of overlap', async ({
  context,
  extensionId
}) => {
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await popup.setViewportSize({ width: 360, height: 640 });
  await expect(popup.getByText('Siftmark').first()).toBeVisible();
  await expectVisualIntegrity(popup, 'popup 360x640');

  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(
    manager,
    '用于验证窄屏文本适配的超长文件夹名称'
  );
  await manager.evaluate(
    (parentId) =>
      chrome.bookmarks.create({
        parentId,
        title: '用于验证标题不会挤压相邻控件的超长书签名称',
        url: 'https://overlap.siftmark.test/a/very/long/path'
      }),
    folderId
  );
  await manager.setViewportSize({ width: 800, height: 700 });
  await manager.reload();
  await manager
    .getByRole('treeitem', {
      name: '用于验证窄屏文本适配的超长文件夹名称'
    })
    .click();
  await expect(
    manager.getByText('用于验证标题不会挤压相邻控件的超长书签名称')
  ).toBeVisible();
  await expectVisualIntegrity(manager, 'manager 800x700');
  await manager.getByRole('button', { name: '打开详情' }).click();
  await expect(manager.getByRole('dialog', { name: '书签详情' })).toBeVisible();
  await expectVisualIntegrity(manager, 'manager detail drawer');

  const options = await openExtensionPage(context, extensionId, 'options.html');
  await options.setViewportSize({ width: 360, height: 760 });
  await expect(
    options.getByRole('heading', { name: '权限与隐私' })
  ).toBeVisible();
  await expectVisualIntegrity(options, 'onboarding 360x760');

  await completeOnboarding(options);
  await options.setViewportSize({ width: 800, height: 700 });
  await expect(options.getByRole('heading', { name: '设置' })).toBeVisible();
  await expectVisualIntegrity(options, 'options 800x700');

  await options
    .locator('input[type="file"]')
    .setInputFiles(
      path.join(
        process.cwd(),
        'tests',
        'fixtures',
        'backup',
        'markai-backup.json'
      )
    );
  await options.getByRole('button', { name: '本地解析' }).click();
  await expect(options.getByText('MarkAI · 版本 1')).toBeVisible();
  const reset = options.locator('.reset-section');
  await reset.getByLabel('重置范围').selectOption('all-siftmark-data');
  await reset.getByRole('button', { name: '预览影响' }).click();
  await expect(reset.getByLabel('确认短语')).toBeVisible();
  await expectVisualIntegrity(options, 'import and reset states');
});

async function expectVisualIntegrity(page: Page, surface: string) {
  const issues = await page.evaluate(() => {
    const findings: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      findings.push(
        `horizontal-scroll:${root.scrollWidth}>${root.clientWidth}`
      );
    }

    const selector = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true
        }) &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        box.width > 0 &&
        box.height > 0 &&
        box.right > 0 &&
        box.bottom > 0 &&
        box.left < innerWidth &&
        box.top < innerHeight
      );
    };
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(selector)
    )
      .filter(visible)
      .map((element, index) => ({
        element,
        index,
        box: element.getBoundingClientRect(),
        atomic: element.matches(
          'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"]'
        ),
        name:
          element.getAttribute('aria-label') ||
          element.textContent?.trim().slice(0, 40) ||
          element.tagName.toLowerCase()
      }));

    for (const control of controls) {
      if (control.box.width < 1 || control.box.height < 1) {
        findings.push(`zero-size:${control.name}`);
      }
      if (
        control.element.matches(
          'button, summary, [role="button"], [role="tab"]'
        ) &&
        control.element.scrollWidth > control.element.clientWidth + 1
      ) {
        findings.push(`clipped-label:${control.name}`);
      }

      let parent = control.element.parentElement;
      while (parent && !visible(parent)) parent = parent.parentElement;
      if (parent) {
        const parentBox = parent.getBoundingClientRect();
        if (
          control.box.left < parentBox.left - 1 ||
          control.box.right > parentBox.right + 1
        ) {
          findings.push(`outside-parent:${control.name}`);
        }
      }
    }

    for (let left = 0; left < controls.length; left += 1) {
      for (let right = left + 1; right < controls.length; right += 1) {
        const first = controls[left]!;
        const second = controls[right]!;
        if (!first.atomic || !second.atomic) continue;
        if (
          first.element.contains(second.element) ||
          second.element.contains(first.element)
        ) {
          continue;
        }
        const overlapWidth =
          Math.min(first.box.right, second.box.right) -
          Math.max(first.box.left, second.box.left);
        const overlapHeight =
          Math.min(first.box.bottom, second.box.bottom) -
          Math.max(first.box.top, second.box.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          findings.push(`overlap:${first.name}|${second.name}`);
        }
      }
    }
    return [...new Set(findings)];
  });

  expect(issues, `${surface} visual integrity`).toEqual([]);
}
