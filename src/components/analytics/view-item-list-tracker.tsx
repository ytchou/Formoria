'use client';

import { useEffect } from 'react';

import { trackViewItemList } from '@/lib/analytics';

export function ViewItemListTracker({
  listName,
  itemCount,
}: {
  listName: string;
  itemCount: number;
}) {
  useEffect(() => {
    trackViewItemList(listName, itemCount);
  }, [listName, itemCount]);

  return null;
}
