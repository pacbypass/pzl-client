import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Ośrodki hodowli zwierzyny"
      icon="pine-tree"
      description="Ośrodki hodowli zwierzyny (OHZ) i ich upoważnienia."
      endpoints={[
        'GET  /units/{unit-id}/game-breeding-centers',
        'GET  /units/{unit-id}/game-breeding-centers/authorizations',
      ]}
    />
  );
}
