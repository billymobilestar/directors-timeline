import React from 'react';
import { Button } from '@/components/ui/Button';

export default function EmptyState({
  title,
  description,
  actionText,
  onAction,
}: {
  title: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}) {
  return (
    <div className="h-full w-full grid place-items-center">
      <div className="text-center max-w-md px-6">
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        {description && <p className="text-neutral-400 mb-4">{description}</p>}
        {actionText && onAction && (
          <Button onClick={onAction} color="primary">{actionText}</Button>
        )}
      </div>
    </div>
  );
}