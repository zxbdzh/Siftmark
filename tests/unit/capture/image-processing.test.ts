import { describe, expect, it } from 'vitest';
import { fitWithin, THUMBNAIL_MAX_EDGE, THUMBNAIL_WEBP_QUALITY } from '../../../src/capture/image-processing';

describe('thumbnail image constraints', () => {
  it('fits the longest edge to 1280 without upsampling', () => {
    expect(fitWithin(2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
    expect(THUMBNAIL_MAX_EDGE).toBe(1280);
    expect(THUMBNAIL_WEBP_QUALITY).toBe(0.72);
  });
});
