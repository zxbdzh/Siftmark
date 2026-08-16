import type { ImgHTMLAttributes } from 'react';
import brandMarkUrl from '../../../assets/icons/siftmark-128.png?inline';

interface BrandMarkProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    'alt' | 'children' | 'height' | 'src' | 'width'
  > {
  size?: number;
  title?: string;
}

export function BrandMark({
  size = 32,
  title,
  className,
  ...props
}: BrandMarkProps) {
  return (
    <img
      {...props}
      className={className}
      width={size}
      height={size}
      src={brandMarkUrl}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      draggable={false}
    />
  );
}
