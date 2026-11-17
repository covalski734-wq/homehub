import type { AssetDto } from '@homehub/shared';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** Stable hue per asset for the letter badge shown without (or before) a CoinGecko image. */
function hue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function AssetIcon({ asset, size = 'md' }: { asset: AssetDto; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = useState(false);
  const box = size === 'sm' ? 'size-6 text-[9px]' : 'size-10 text-xs';
  if (asset.image && !failed)
    return (
      <img
        src={asset.image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full bg-muted object-cover', box)}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        box,
      )}
      style={{ backgroundColor: `oklch(0.6 0.13 ${hue(asset.id)})` }}
    >
      {asset.symbol.slice(0, 4)}
    </span>
  );
}
