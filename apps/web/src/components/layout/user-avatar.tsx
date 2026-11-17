import { useState } from 'react';
import { cn } from '@/lib/utils';

export function UserAvatar({
  name,
  email,
  src,
  className,
}: {
  name: string | null;
  email: string;
  src: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = (name ?? email).trim().slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold',
        className,
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}
