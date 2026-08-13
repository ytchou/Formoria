'use client';

import { useEffect } from 'react';

import { trackStockistListViewed, trackViewItemList } from '@/lib/analytics';

export function ViewItemListTracker({
  listName,
  itemCount,
  stockists = false,
}: {
  listName: string;
  itemCount: number;
  stockists?: boolean;
}) {
  useEffect(() => {
    if (stockists) trackStockistListViewed(listName, itemCount);
    else trackViewItemList(listName, itemCount);
  }, [listName, itemCount, stockists]);

  return null;
}
