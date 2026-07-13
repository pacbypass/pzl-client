import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Elektroniczna książka polowań"
      icon="book-open-variant"
      description="Ewidencja pobytu na polowaniu indywidualnym (LOW-1) i załączniki."
      endpoints={[
        'GET/POST  /units/{unit-id}/low1',
        'GET/POST  /units/{unit-id}/low1-attach',
        'GET       /units/{unit-id}/electronic-hunting-book',
      ]}
    />
  );
}
